#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { initStore, listMemories, saveMemory } from "./storage.js";
import { formatInjection, searchMemories } from "./retrieval.js";
import { approvePending, createReflection, createReflectionFromSession, formatPendingReview, latestPendingReviewFile } from "./reflection.js";
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
import { continueWorkflow, getWorkflowStatus, resumeWorkflow, runWorkflow } from "./runner.js";
import { doctor, formatDoctor, setupIntegration, uninstallIntegration } from "./setup.js";
import { formatConfig, readConfig, writeConfig } from "./config.js";

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
  console.log(`ContextBrain

Commands:
  cbr init
  cbr setup [--force] [--no-agents]
  cbr doctor
  cbr verify
  cbr agent "task" [--dry-run] [--agent-command "codex exec"]
  cbr uninstall
  cbr save --type decision --title "Use X" --body "..." [--code src/file.js] [--tag cli]
  cbr search "query" [--limit 5]
  cbr context "task"
  cbr config [--agent-command "..."] [--resume-command "..."] [--auto-reflect true|false]
  cbr prompt "task"
  cbr run "task" [--dry-run] [--agent-command "codex exec"]
  cbr resume ["follow-up task"] [--dry-run] [--agent-command "codex resume --last"]
  cbr continue [--dry-run]
  cbr status
  cbr learn
  cbr inject "current task" [--limit 5]
  cbr reflect --task "..." --file notes.md [--approve-high-confidence]
  cbr reflect --session SESSION_ID_OR_JSON
  cbr review [pending.json|--latest]
  cbr review pending.json --approve 1,3
  cbr review pending.json --reject 2
  cbr review pending.json --approve-all
  cbr review pending.json --reject-all
  cbr session start --task "..." [--request "..."]
  cbr session note "..."
  cbr session add-file src/file.js
  cbr session command "npm test" [--status passed]
  cbr session error "..."
  cbr session status
  cbr session stop --summary "..." [--commit HASH]

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
      console.log(`Initialized ContextBrain at ${p.base}`);
      return;
    }

    if (command === "setup") {
      const result = setupIntegration({
        force: Boolean(args.force),
        agents: !args["no-agents"]
      });
      console.log("cbr setup complete.");
      console.log(`Wrapper directory: ${result.bin_dir}`);
      console.log(`Config: ${result.config}`);
      console.log(`Project rules: ${result.project_rules}`);
      if (result.agent_bridge.status === "installed") {
        console.log(`Agent instructions bridge: ${result.agent_bridge.file_path}`);
      } else if (result.agent_bridge.status === "existing-agents-left-unchanged") {
        console.log(`Existing AGENTS.md left unchanged: ${result.agent_bridge.file_path}`);
        console.log(`Bridge snippet written to: ${result.agent_bridge.snippet_path}`);
      }
      console.log("");
      console.log("Use now if cbr is on PATH:");
      console.log(`  cbr "your task"`);
      console.log("");
      console.log("Repo-local fallback:");
      console.log(`  ${path.join(result.bin_dir, process.platform === "win32" ? "cbr.cmd" : "cbr")} "your task"`);
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

    if (command === "verify") {
      console.log(formatDoctor(doctor()));
      console.log("");
      const result = runWorkflow("verify cbr setup", {
        dryRun: true,
        autoReflect: false
      });
      console.log("Dry-run workflow: OK");
      console.log(`Session: ${result.session.id}`);
      console.log(`Prompt: ${result.promptPath}`);
      console.log(`Context: ${result.contextPath}`);
      return;
    }

    if (command === "config") {
      const updates = {};
      if (args["agent-command"]) updates.agentCommand = args["agent-command"];
      if (args["resume-command"]) updates.resumeCommand = args["resume-command"];
      if (args["auto-reflect"] !== undefined) updates.autoReflect = parseBoolean(args["auto-reflect"], "auto-reflect");
      const config = Object.keys(updates).length ? writeConfig(updates) : readConfig();
      console.log(formatConfig(config));
      return;
    }

    if (command === "uninstall") {
      const result = uninstallIntegration();
      if (result.removed.length === 0) {
        console.log("No ContextBrain-generated setup files found.");
      } else {
        console.log("Removed ContextBrain-generated setup files:");
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

    if (command === "run" || command === "agent") {
      const task = args._.join(" ");
      if (!task.trim()) throw new Error(`${command} requires a task.`);
      const config = readConfig();
      const result = runWorkflow(task, {
        dryRun: Boolean(args["dry-run"]),
        codexCommand: args["agent-command"] || config.agentCommand,
        autoReflect: config.autoReflect
      });
      console.log(`Session: ${result.session.id}`);
      console.log(`Prompt: ${result.promptPath}`);
      console.log(`Context: ${result.contextPath}`);
      console.log(`Agent launch: ${result.launch.status}`);
      if (result.reflection) {
        console.log(`Reflection: ${result.reflection.reflection.id}`);
        console.log(`Pending learnings: ${result.reflection.pending.length}`);
      }
      return;
    }

    if (command === "continue") {
      const config = readConfig();
      const result = continueWorkflow({
        dryRun: Boolean(args["dry-run"]),
        codexCommand: args["agent-command"] || config.agentCommand
      });
      console.log(`Session: ${result.session.id}`);
      console.log(`Prompt: ${result.promptPath}`);
      console.log(`Agent launch: ${result.launch.status}`);
      return;
    }

    if (command === "resume") {
      const task = args._.join(" ");
      const config = readConfig();
      const result = resumeWorkflow(task, {
        dryRun: Boolean(args["dry-run"]),
        agentCommand: args["agent-command"] || config.resumeCommand,
        autoReflect: config.autoReflect
      });
      console.log(`Session: ${result.session.id}`);
      console.log(`Prompt: ${result.promptPath}`);
      console.log(`Agent resume: ${result.launch.status}`);
      if (result.reflection) {
        console.log(`Reflection: ${result.reflection.reflection.id}`);
        console.log(`Pending learnings: ${result.reflection.pending.length}`);
      }
      return;
    }

    if (command === "status") {
      const status = getWorkflowStatus();
      if (!status.last) {
        console.log("No cbr sessions found.");
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
      const filePath = args._[0] || latestPendingReviewFile();
      if (!filePath) throw new Error("No pending review files found.");
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
      if (result.duplicateCount) {
        console.log(`Skipped ${result.duplicateCount} duplicate candidate${result.duplicateCount === 1 ? "" : "s"}.`);
        for (const item of result.duplicates) {
          const matches = item.duplicates.map((duplicate) => duplicate.title).join("; ");
          console.log(`- Duplicate: ${item.candidate.title} already matches ${matches}`);
        }
      }
      if (result.conflictCount) {
        console.log(`Approved ${result.conflictCount} candidate${result.conflictCount === 1 ? "" : "s"} with potential conflict${result.conflictCount === 1 ? "" : "s"}.`);
        for (const item of result.conflicts) {
          const matches = item.conflicts.map((conflict) => conflict.title).join("; ");
          console.log(`- Conflict: ${item.candidate.title} conflicts with ${matches}`);
        }
      }
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

function parseBoolean(value, name) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new Error(`--${name} must be true or false.`);
}

main();



