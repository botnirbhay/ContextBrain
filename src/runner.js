import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { buildCodexPrompt } from "./context.js";
import { createReflectionFromSession } from "./reflection.js";
import { endSession, getCurrentSession, listSessions, startSession, updateSessionRecord } from "./session.js";
import { paths, writeJson } from "./storage.js";

export function preparePrompt(task, { root = process.cwd(), markUsed = false } = {}) {
  const p = paths(root);
  const { pack, prompt } = buildCodexPrompt(task, { root, markUsed });
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const contextPath = path.join(p.sessions, `${stamp}-context.json`);
  const promptPath = path.join(p.sessions, `${stamp}-prompt.md`);
  writeJson(contextPath, pack);
  fs.writeFileSync(promptPath, prompt);
  return { pack, prompt, contextPath, promptPath };
}

export function runWorkflow(task, {
  root = process.cwd(),
  codexCommand = "codex",
  dryRun = false,
  autoReflect = true
} = {}) {
  const session = startSession({ task, request: task }, root);
  const prepared = preparePrompt(task, { root, markUsed: true });
  updateSessionRecord({
    ...session,
    memories_used: prepared.pack.memories_used,
    context_pack_file: prepared.contextPath,
    prompt_file: prepared.promptPath
  }, root);

  let launch = { status: "dry-run", stdout: "", stderr: "", exitCode: 0 };
  if (!dryRun) {
    const commandParts = splitCommand(codexCommand);
    const result = spawnSync(commandParts[0], [...commandParts.slice(1), prepared.prompt], {
      cwd: root,
      encoding: "utf8",
      shell: process.platform === "win32"
    });
    launch = {
      status: result.status === 0 ? "completed" : "failed",
      stdout: result.stdout || "",
      stderr: result.stderr || result.error?.message || "",
      exitCode: result.status ?? 1
    };
  }

  const diffSummary = getGitDiffSummary(root);
  const changedFiles = getGitChangedFiles(root);
  const commit = getHeadCommit(root);
  const stopped = endSession({
    summary: launch.status === "dry-run"
      ? "Prepared Codex prompt and context pack without launching Codex."
      : `Codex process ${launch.status} with exit code ${launch.exitCode}.`,
    commit
  }, root);
  updateSessionRecord({
    ...stopped,
    git_diff_summary: diffSummary,
    files_changed: unique([...(stopped.files_changed || []), ...changedFiles]),
    commands_run: [
      ...(stopped.commands_run || []),
      { created_at: new Date().toISOString(), command: `${codexCommand} <prompt>`, status: launch.status, output: launch.stderr || launch.stdout.slice(0, 1000) }
    ]
  }, root);

  const reflection = autoReflect ? createReflectionFromSession(stopped.file_path, { root }) : null;
  return { session: stopped, ...prepared, launch, reflection };
}

export function continueWorkflow({ root = process.cwd(), codexCommand = "codex", dryRun = false } = {}) {
  const session = getCurrentSession(root) || listSessions(root).at(-1);
  if (!session) {
    throw new Error("No session available to continue.");
  }
  const task = session.task || session.request;
  const prepared = preparePrompt(task, { root, markUsed: true });
  updateSessionRecord({
    ...session,
    status: "active",
    memories_used: prepared.pack.memories_used,
    context_pack_file: prepared.contextPath,
    prompt_file: prepared.promptPath
  }, root);

  if (!dryRun) {
    const commandParts = splitCommand(codexCommand);
    spawnSync(commandParts[0], [...commandParts.slice(1), prepared.prompt], {
      cwd: root,
      stdio: "inherit",
      shell: process.platform === "win32"
    });
  }
  return { session, ...prepared, launch: { status: dryRun ? "dry-run" : "launched" } };
}

export function getWorkflowStatus({ root = process.cwd() } = {}) {
  const active = getCurrentSession(root);
  const last = listSessions(root).at(-1) || null;
  const session = active || last;
  if (!session) return { active: null, last: null };
  return {
    active,
    last: session,
    memories_used: session.memories_used || [],
    files_touched: session.files_changed || [],
    prompt_file: session.prompt_file || "",
    context_pack_file: session.context_pack_file || "",
    git_diff_summary: session.git_diff_summary || ""
  };
}

function splitCommand(command) {
  return String(command).match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, "")) || ["codex"];
}

function getGitDiffSummary(root) {
  const result = spawnSync("git", ["diff", "--stat"], { cwd: root, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function getGitChangedFiles(root) {
  const result = spawnSync("git", ["status", "--short"], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^.. /, "").replace(/^.."/, "").replace(/"$/, ""))
    .map((line) => line.includes(" -> ") ? line.split(" -> ").at(-1) : line)
    .filter((line) => line && !line.startsWith(".codexmemory/"));
}

function getHeadCommit(root) {
  const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
