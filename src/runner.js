import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { buildCodexPrompt } from "./context.js";
import { createReflectionFromSession } from "./reflection.js";
import { activateSession, endSession, getCurrentSession, listSessions, startSession, updateSessionRecord } from "./session.js";
import { paths, writeJson } from "./storage.js";

export function preparePrompt(task, { root = process.cwd(), markUsed = false } = {}) {
  const p = paths(root);
  const { pack, prompt } = buildCodexPrompt(task, { root, markUsed });
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const contextPath = uniqueArtifactPath(path.join(p.sessions, `${stamp}-context.json`));
  const promptPath = uniqueArtifactPath(path.join(p.sessions, `${stamp}-prompt.md`));
  writeJson(contextPath, pack);
  fs.writeFileSync(promptPath, prompt);
  return { pack, prompt, contextPath, promptPath };
}

export function runWorkflow(task, {
  root = process.cwd(),
  codexCommand = "codex exec",
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
    const result = spawnCodexCommand(codexCommand, prepared.prompt, {
      cwd: root,
      inherit: false
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
      { created_at: new Date().toISOString(), command: `${codexCommand} <prompt-stdin>`, status: launch.status, output: launch.stderr || launch.stdout.slice(0, 1000) }
    ]
  }, root);

  const reflection = autoReflect ? createReflectionFromSession(stopped.file_path, { root }) : null;
  return { session: stopped, ...prepared, launch, reflection };
}

export function continueWorkflow({ root = process.cwd(), codexCommand = "codex exec", dryRun = false } = {}) {
  const session = getCurrentSession(root) || listSessions(root).at(-1);
  if (!session) {
    throw new Error("No session available to continue.");
  }
  const task = session.task || session.request;
  const prepared = preparePrompt(task, { root, markUsed: true });
  const active = activateSession({
    ...session,
    memories_used: prepared.pack.memories_used,
    context_pack_file: prepared.contextPath,
    prompt_file: prepared.promptPath
  }, root);

  if (!dryRun) {
    spawnCodexCommand(codexCommand, prepared.prompt, {
      cwd: root,
      inherit: true
    });
  }
  return { session: active, ...prepared, launch: { status: dryRun ? "dry-run" : "launched" } };
}

export function resumeWorkflow(task = "", {
  root = process.cwd(),
  agentCommand = "codex resume --last",
  dryRun = false,
  autoReflect = true
} = {}) {
  const session = getCurrentSession(root) || listSessions(root).at(-1);
  if (!session) {
    throw new Error("No session available to resume.");
  }

  const resumeTask = task.trim() || `Continue previous task: ${session.task || session.request}`;
  const prepared = preparePrompt(resumeTask, { root, markUsed: true });
  activateSession({
    ...session,
    request: resumeTask,
    memories_used: prepared.pack.memories_used,
    context_pack_file: prepared.contextPath,
    prompt_file: prepared.promptPath
  }, root);

  let launch = { status: "dry-run", stdout: "", stderr: "", exitCode: 0 };
  if (!dryRun) {
    const result = spawnAgentCommandWithPromptArgument(agentCommand, prepared.prompt, {
      cwd: root,
      inherit: true
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
      ? "Prepared agent resume prompt and context pack without launching the agent."
      : `Agent resume ${launch.status} with exit code ${launch.exitCode}.`,
    commit
  }, root);
  updateSessionRecord({
    ...stopped,
    git_diff_summary: diffSummary,
    files_changed: unique([...(stopped.files_changed || []), ...changedFiles]),
    commands_run: [
      ...(stopped.commands_run || []),
      { created_at: new Date().toISOString(), command: `${agentCommand} <prompt-arg>`, status: launch.status, output: launch.stderr || launch.stdout.slice(0, 1000) }
    ]
  }, root);

  const refreshed = listSessions(root).find((item) => item.id === stopped.id) || stopped;
  const reflection = autoReflect ? createReflectionFromSession(refreshed.file_path, { root }) : null;
  return { session: refreshed, ...prepared, launch, reflection };
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

function spawnCodexCommand(command, prompt, { cwd, inherit }) {
  const options = {
    cwd,
    input: prompt,
    encoding: "utf8",
    stdio: inherit ? ["pipe", "inherit", "inherit"] : ["pipe", "pipe", "pipe"]
  };
  if (process.platform === "win32") {
    return spawnSync(command, [], { ...options, shell: true });
  }
  const commandParts = splitCommand(command);
  return spawnSync(commandParts[0], commandParts.slice(1), options);
}

function spawnAgentCommandWithPromptArgument(command, prompt, { cwd, inherit }) {
  const commandParts = [...splitCommand(command), prompt];
  const options = {
    cwd,
    encoding: "utf8",
    stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"]
  };
  if (process.platform === "win32") {
    return spawnSync(commandParts.map(quoteWindowsShellArg).join(" "), [], { ...options, shell: true });
  }
  return spawnSync(commandParts[0], commandParts.slice(1), options);
}

function quoteWindowsShellArg(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=+-]+$/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
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
    .filter((line) => line && !line.startsWith(".codemem/") && !line.startsWith(".codexmemory/"));
}

function getHeadCommit(root) {
  const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function uniqueArtifactPath(filePath) {
  if (!fs.existsSync(filePath)) return filePath;
  const parsed = path.parse(filePath);
  for (let idx = 2; idx < 1000; idx += 1) {
    const candidate = path.join(parsed.dir, `${parsed.name}-${idx}${parsed.ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`Could not create unique artifact path for ${filePath}`);
}
