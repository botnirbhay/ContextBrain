#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { initStore, listMemories, saveMemory } from "./storage.js";
import { formatInjection, searchMemories } from "./retrieval.js";
import { approvePending, createReflection, createReflectionFromSession, formatPendingReview } from "./reflection.js";
import {
  addSessionCommand,
  addSessionError,
  addSessionFile,
  addSessionNote,
  endSession,
  getCurrentSession,
  listSessions,
  startSession
} from "./session.js";
import { MEMORY_TYPES } from "./schema.js";
import { buildContextPack, buildCodexPrompt, formatContextPack } from "./context.js";
import { writeAgentsFile } from "./learn.js";
import { continueWorkflow, getWorkflowStatus, runWorkflow } from "./runner.js";
import { doctor, formatDoctor, setupIntegration, uninstallIntegration } from "./setup.js";

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { _: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const value = rest[i];
    if (value.startsWith("--")) {
      const key = value.slice(2);
      const next = rest[i + 1];
      if (!next || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i += 1;
      }
    } else {
      args._.push(value);
    }
  }
  return { command, args };
}

function readInput(args) {
  if (args.file) return fs.readFileSync(path.resolve(args.file), "utf8");
  if (args.body) return args.body;
  if (!process.stdin.isTTY) return fs.readFileSync(0, "utf8");
  return "";
}

function printHelp() {
  console.log(`CodexMemory

Commands:
  codexmemory init
  codexmemory setup [--force] [--no-agents]
  codexmemory doctor
  codexmemory codex "task" [--dry-run] [--codex-command codex]
  codexmemory uninstall
  codexmemory save --type decision --title "Use X" --body "..." [--code src/file.js] [--tag cli]
  codexmemory search "query" [--limit 5]
  codexmemory context "task"
  codexmemory prompt "task"
  codexmemory run "task" [--dry-run] [--codex-command codex]
  codexmemory continue [--dry-run]
  codexmemory status
  codexmemory learn
  codexmemory inject "current task" [--limit 5]
  codexmemory reflect --task "..." --file notes.md [--approve-high-confidence]
  codexmemory reflect --session SESSION_ID_OR_JSON
  codexmemory review pending.json
  codexmemory review pending.json --approve 1,3
  codexmemory review pending.json --reject 2
  codexmemory review pending.json --approve-all
  codexmemory review pending.json --reject-all
  codexmemory session start --task "..." [--request "..."]
  codexmemory session note "..."
  codexmemory session add-file src/file.js
  codexmemory session command "npm test" [--status passed]
  codexmemory session error "..."
  codexmemory session status
  codexmemory session stop --summary "..." [--commit HASH]

Memory types: ${MEMORY_TYPES.join(", ")}
`);
}

async function main() {
  const { command, args } = parseArgs(process.argv.slice(2));
  try {
    if (!command || command === "help" || command === "--help") {
      printHelp();
      return;
    }

    if (command === "init") {
      const p = initStore();
      console.log(`Initialized CodexMemory at ${p.base}`);
      return;
    }

    if (command === "setup") {
      const result = setupIntegration({
        force: Boolean(args.force),
        agents: !args["no-agents"]
      });
      console.log("CodexMemory setup complete.");
      console.log(`Wrapper directory: ${result.bin_dir}`);
      console.log(`Project rules: ${result.project_rules}`);
      if (result.agent_bridge.status === "installed") {
        console.log(`Codex AGENTS bridge: ${result.agent_bridge.file_path}`);
      } else if (result.agent_bridge.status === "existing-agents-left-unchanged") {
        console.log(`Existing AGENTS.md left unchanged: ${result.agent_bridge.file_path}`);
        console.log(`Bridge snippet written to: ${result.agent_bridge.snippet_path}`);
      }
      console.log("");
      console.log("Use now:");
      console.log(`  ${path.join(result.bin_dir, process.platform === "win32" ? "codexm.cmd" : "codexm")} "your task"`);
      console.log("");
      console.log("Optional PATH setup:");
      console.log(`  PowerShell current session: ${result.path_instructions.powershell_current_session}`);
      console.log(`  PowerShell user PATH: ${result.path_instructions.powershell_current_user}`);
      console.log(`  bash/zsh: ${result.path_instructions.bash_zsh}`);
      return;
    }

    if (command === "doctor") {
      console.log(formatDoctor(doctor()));
      return;
    }

    if (command === "uninstall") {
      const result = uninstallIntegration();
      if (result.removed.length === 0) {
        console.log("No CodexMemory-generated setup files found.");
      } else {
        console.log("Removed CodexMemory-generated setup files:");
        for (const filePath of result.removed) console.log(`  ${filePath}`);
      }
      return;
    }

    if (command === "save") {
      const body = readInput(args);
      if (!args.type || !args.title || !body.trim()) {
        throw new Error("save requires --type, --title, and --body, --file, or stdin content.");
      }
      const memory = saveMemory({
        type: args.type,
        title: args.title,
        body,
        rationale: args.rationale || "",
        next_time: args["next-time"] || "",
        confidence: args.confidence ? Number(args.confidence) : 0.7,
        tags: args.tag ? String(args.tag).split(",").map((tag) => tag.trim()).filter(Boolean) : [],
        code_paths: args.code ? String(args.code).split(",").map((code) => code.trim()).filter(Boolean) : []
      });
      console.log(`Saved ${memory.type} memory: ${memory.file_path}`);
      return;
    }

    if (command === "search") {
      const query = args._.join(" ");
      const results = searchMemories(query, { limit: Number(args.limit || 5) });
      for (const result of results) {
        console.log(`${result.score.toFixed(3)} ${result.memory.type} ${result.memory.title}`);
        console.log(`  ${result.reasons.join("; ") || "general relevance"}`);
        console.log(`  ${result.memory.file_path}`);
      }
      return;
    }

    if (command === "context") {
      const task = args._.join(" ");
      if (!task.trim()) throw new Error("context requires a task.");
      console.log(formatContextPack(buildContextPack(task, { limit: Number(args.limit || 8) })));
      return;
    }

    if (command === "prompt") {
      const task = args._.join(" ");
      if (!task.trim()) throw new Error("prompt requires a task.");
      console.log(buildCodexPrompt(task).prompt);
      return;
    }

    if (command === "run" || command === "codex") {
      const task = args._.join(" ");
      if (!task.trim()) throw new Error(`${command} requires a task.`);
      const result = runWorkflow(task, {
        dryRun: Boolean(args["dry-run"]),
        codexCommand: args["codex-command"] || "codex"
      });
      console.log(`Session: ${result.session.id}`);
      console.log(`Prompt: ${result.promptPath}`);
      console.log(`Context: ${result.contextPath}`);
      console.log(`Codex launch: ${result.launch.status}`);
      if (result.reflection) {
        console.log(`Reflection: ${result.reflection.reflection.id}`);
        console.log(`Pending learnings: ${result.reflection.pending.length}`);
      }
      return;
    }

    if (command === "continue") {
      const result = continueWorkflow({
        dryRun: Boolean(args["dry-run"]),
        codexCommand: args["codex-command"] || "codex"
      });
      console.log(`Session: ${result.session.id}`);
      console.log(`Prompt: ${result.promptPath}`);
      console.log(`Codex launch: ${result.launch.status}`);
      return;
    }

    if (command === "status") {
      const status = getWorkflowStatus();
      if (!status.last) {
        console.log("No CodexMemory sessions found.");
        return;
      }
      console.log(`Active: ${status.active ? status.active.id : "none"}`);
      console.log(`Last: ${status.last.id} ${status.last.status} ${status.last.task}`);
      console.log(`Memories used: ${status.memories_used.join(", ") || "none"}`);
      console.log(`Files touched: ${status.files_touched.join(", ") || "none"}`);
      if (status.prompt_file) console.log(`Prompt: ${status.prompt_file}`);
      if (status.context_pack_file) console.log(`Context: ${status.context_pack_file}`);
      if (status.git_diff_summary) console.log(`Git diff:\n${status.git_diff_summary}`);
      return;
    }

    if (command === "learn") {
      const filePath = writeAgentsFile();
      console.log(`Generated project instructions: ${filePath}`);
      return;
    }

    if (command === "inject") {
      const query = args._.join(" ");
      const results = searchMemories(query, { limit: Number(args.limit || 5) });
      console.log(formatInjection(results, { maxItems: Number(args.limit || 5) }));
      return;
    }

    if (command === "reflect") {
      if (args.session) {
        const result = createReflectionFromSession(args.session, {
          approveHighConfidence: Boolean(args["approve-high-confidence"])
        });
        console.log(`Reflection: ${result.reflection.id}`);
        console.log(`Session: ${result.reflection.session_id}`);
        console.log(`Proposed memories pending review: ${result.pending.length}`);
        console.log(`Approved high-confidence memories: ${result.approved.length}`);
        return;
      }

      const notes = readInput(args);
      if (!notes.trim()) {
        throw new Error("reflect requires --body, --file, --session, or stdin task notes.");
      }
      const result = createReflection(notes, {
        task: args.task || "Task reflection",
        approveHighConfidence: Boolean(args["approve-high-confidence"])
      });
      console.log(`Reflection: ${result.reflection.id}`);
      console.log(`Proposed memories pending review: ${result.pending.length}`);
      console.log(`Approved high-confidence memories: ${result.approved.length}`);
      return;
    }

    if (command === "review") {
      const filePath = args._[0];
      if (!filePath) throw new Error("review requires a pending reflection JSON file.");
      const resolved = path.resolve(filePath);
      const approve = parseIndexList(args.approve || args.only);
      const reject = parseIndexList(args.reject);
      if (!approve.length && !reject.length && !args["approve-all"] && !args["reject-all"]) {
        console.log(formatPendingReview(resolved));
        return;
      }
      const result = approvePending(resolved, {
        indices: approve,
        reject,
        approveAll: Boolean(args["approve-all"]),
        rejectAll: Boolean(args["reject-all"])
      });
      console.log(`Approved ${result.count} memor${result.count === 1 ? "y" : "ies"}.`);
      console.log(`Rejected ${result.rejected} candidate${result.rejected === 1 ? "" : "s"}.`);
      return;
    }

    if (command === "session") {
      const action = args._[0];
      if (action === "start") {
        const session = startSession({
          task: args.task || "Untitled task",
          request: args.request || ""
        });
        console.log(`Started session: ${session.id}`);
        console.log(session.file_path);
        return;
      }

      if (action === "note") {
        const note = args._.slice(1).join(" ") || readInput(args);
        const session = addSessionNote(note);
        console.log(`Added note to session: ${session.id}`);
        return;
      }

      if (action === "add-file") {
        const file = args._.slice(1).join(" ");
        const session = addSessionFile(file);
        console.log(`Added file to session: ${session.id}`);
        return;
      }

      if (action === "command") {
        const commandText = args._.slice(1).join(" ") || readInput(args);
        const session = addSessionCommand(commandText, {
          status: args.status || "recorded",
          output: args.output || ""
        });
        console.log(`Added command to session: ${session.id}`);
        return;
      }

      if (action === "error") {
        const errorText = args._.slice(1).join(" ") || readInput(args);
        const session = addSessionError(errorText);
        console.log(`Added error to session: ${session.id}`);
        return;
      }

      if (action === "current" || action === "status") {
        const session = getCurrentSession();
        if (!session) {
          console.log("No active session.");
          return;
        }
        console.log(`${session.id} ${session.status} ${session.task}`);
        console.log(session.file_path);
        return;
      }

      if (action === "end" || action === "stop") {
        const session = endSession({
          note: readInput(args),
          summary: args.summary || "",
          outcome: args.outcome || "",
          commit: args.commit || ""
        });
        console.log(`Ended session: ${session.id}`);
        console.log(session.file_path);
        return;
      }

      if (action === "list") {
        for (const session of listSessions()) {
          console.log(`${session.id} ${session.status} ${session.task}`);
        }
        return;
      }

      throw new Error("session requires one of: start, note, add-file, command, error, status, stop, list");
    }

    if (command === "list") {
      for (const memory of listMemories()) {
        console.log(`${memory.type} ${memory.title} (${memory.id})`);
      }
      return;
    }

    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

function parseIndexList(value) {
  if (!value) return [];
  return String(value).split(",").map((item) => Number(item.trim())).filter(Boolean);
}

main();
