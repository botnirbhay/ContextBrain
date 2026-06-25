import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { initStore, paths } from "./storage.js";
import { writeAgentsFile } from "./learn.js";

const WRAPPER_MARKER = "CODEMEM_GENERATED_WRAPPER";
const AGENTS_MARKER = "CODEMEM_GENERATED_AGENT_BRIDGE";
const LEGACY_WRAPPER_MARKERS = [WRAPPER_MARKER, "CODEXMEMORY_GENERATED_WRAPPER", "CodeMem_GENERATED_WRAPPER"];
const LEGACY_AGENTS_MARKERS = [AGENTS_MARKER, "CODEXMEMORY_GENERATED_AGENT_BRIDGE", "CodeMem_GENERATED_AGENT_BRIDGE"];

export function setupIntegration({ root = process.cwd(), force = false, agents = true } = {}) {
  const p = initStore(root);
  fs.mkdirSync(p.bin, { recursive: true });
  const cliPath = getCliPath();
  const wrappers = writeWrappers(p.bin, cliPath, { force });
  const projectRules = writeAgentsFile({ root });
  const agentBridge = agents ? ensureAgentBridge(root, { force }) : { status: "skipped", file_path: path.join(root, "AGENTS.md") };

  return {
    bin_dir: p.bin,
    wrappers,
    project_rules: projectRules,
    agent_bridge: agentBridge,
    path_instructions: pathInstructions(p.bin)
  };
}

export function doctor({ root = process.cwd() } = {}) {
  const p = paths(root);
  return [
    check("Node.js >= 20", isNodeSupported(), process.version),
    check("Git available", commandExists("git"), commandPath("git") || "not found"),
    check("Default agent command available", commandExists("codex"), commandPath("codex") || "not found"),
    check("CodeMem store initialized", fs.existsSync(p.base), p.base),
    check("codemem wrapper installed", wrapperExists(p.bin), p.bin),
    check("AGENTS.md bridge present", fs.existsSync(path.join(root, "AGENTS.md")), path.join(root, "AGENTS.md")),
    check(".codemem/AGENTS.md present", fs.existsSync(path.join(p.base, "AGENTS.md")), path.join(p.base, "AGENTS.md")),
    check(".codemem/bin on PATH", pathOnEnv(p.bin), p.bin)
  ];
}

export function formatDoctor(checks) {
  return checks.map((item) => `${item.ok ? "OK" : "WARN"} ${item.name}: ${item.detail}`).join("\n");
}

export function uninstallIntegration({ root = process.cwd() } = {}) {
  const p = paths(root);
  const removed = [];
  for (const file of ["codemem.cmd", "codemem.ps1", "codemem"]) {
    const filePath = path.join(p.bin, file);
    if (isGeneratedFile(filePath, LEGACY_WRAPPER_MARKERS)) {
      fs.unlinkSync(filePath);
      removed.push(filePath);
    }
  }

  const agentsPath = path.join(root, "AGENTS.md");
  if (isGeneratedFile(agentsPath, LEGACY_AGENTS_MARKERS)) {
    fs.unlinkSync(agentsPath);
    removed.push(agentsPath);
  }

  try {
    if (fs.existsSync(p.bin) && fs.readdirSync(p.bin).length === 0) {
      fs.rmdirSync(p.bin);
      removed.push(p.bin);
    }
  } catch {
    // Leave non-empty directories alone.
  }

  return { removed };
}

function writeWrappers(binDir, cliPath, { force }) {
  const normalizedCli = cliPath.replace(/\\/g, "\\\\");
  const wrappers = [
    {
      file: "codemem.cmd",
      content: [
        `@REM ${WRAPPER_MARKER}`,
        "@echo off",
        `node "${cliPath}" %*`
      ].join("\r\n") + "\r\n"
    },
    {
      file: "codemem.ps1",
      content: [
        `# ${WRAPPER_MARKER}`,
        `$CodeMemCli = "${normalizedCli}"`,
        "& node $CodeMemCli @args",
        "exit $LASTEXITCODE"
      ].join("\n") + "\n"
    },
    {
      file: "codemem",
      content: [
        `#!/usr/bin/env sh`,
        `# ${WRAPPER_MARKER}`,
        `node "${cliPath.replace(/"/g, '\\"')}" "$@"`
      ].join("\n") + "\n"
    }
  ];

  return wrappers.map((wrapper) => {
    const filePath = path.join(binDir, wrapper.file);
    writeGeneratedFile(filePath, wrapper.content, LEGACY_WRAPPER_MARKERS, { force });
    if (wrapper.file === "codemem") {
      try {
        fs.chmodSync(filePath, 0o755);
      } catch {
        // Windows can ignore POSIX execute bits.
      }
    }
    return filePath;
  });
}

function ensureAgentBridge(root, { force }) {
  const filePath = path.join(root, "AGENTS.md");
  const content = [
    `<!-- ${AGENTS_MARKER} -->`,
    "# CodeMem Integration",
    "",
    "This repository uses CodeMem for persistent local project memory and task reflection.",
    "",
    "## How To Use Memory",
    "",
    "- Read `.codemem/AGENTS.md` for distilled project rules when it exists.",
    "- For task-specific context, run `codemem context \"<task description>\"` when the command is available.",
    "- Prefer current repository code over memory if they conflict, and mention the conflict before choosing.",
    "- Do not treat raw chat logs as memory. Durable memory should be decisions, conventions, bug fixes, failed attempts, lessons, warnings, or todos.",
    "",
    "## During Work",
    "",
    "- If a CodeMem session is active, record durable notes with `codemem session note \"<durable note>\"`.",
    "- Record touched files with `codemem session add-file <path>` when useful.",
    "- At the end, summarize the durable outcome with `codemem session stop --summary \"<what changed and why>\"`.",
    "",
    "## Recommended User Entry Point",
    "",
    "Users normally run their coding agent through the CodeMem wrapper:",
    "",
    "```bash",
    "codemem \"<task description>\"",
    "```",
    "",
    "To continue the most recent Codex session with fresh memory context:",
    "",
    "```bash",
    "codemem resume \"<follow-up task>\"",
    "```",
    "",
    "This wrapper retrieves memory, prepares the agent prompt, launches the configured coding agent, captures the outcome, and prepares reviewable learnings.",
    ""
  ].join("\n");

  if (fs.existsSync(filePath) && !isGeneratedFile(filePath, LEGACY_AGENTS_MARKERS)) {
    const snippetPath = path.join(root, ".codemem", "AGENTS.bridge.md");
    fs.writeFileSync(snippetPath, content);
    return { status: "existing-agents-left-unchanged", file_path: filePath, snippet_path: snippetPath };
  }
  writeGeneratedFile(filePath, content, LEGACY_AGENTS_MARKERS, { force });
  return { status: "installed", file_path: filePath };
}

function writeGeneratedFile(filePath, content, marker, { force }) {
  if (fs.existsSync(filePath) && !force && !isGeneratedFile(filePath, marker)) {
    throw new Error(`Refusing to overwrite non-CodeMem file: ${filePath}`);
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function isGeneratedFile(filePath, marker) {
  const markers = Array.isArray(marker) ? marker : [marker];
  return fs.existsSync(filePath) && markers.some((item) => fs.readFileSync(filePath, "utf8").includes(item));
}

function getCliPath() {
  return fileURLToPath(new URL("./codemem.js", import.meta.url));
}

function isNodeSupported() {
  const major = Number(process.versions.node.split(".")[0]);
  return major >= 20;
}

function commandExists(command) {
  return Boolean(commandPath(command));
}

function commandPath(command) {
  const direct = spawnSync(command, ["--version"], { encoding: "utf8" });
  if (direct.status === 0) return command;
  const result = process.platform === "win32"
    ? spawnSync("where.exe", [command], { encoding: "utf8" })
    : spawnSync("sh", ["-lc", `command -v ${command}`], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim().split(/\r?\n/)[0] : "";
}

function wrapperExists(binDir) {
  return ["codemem.cmd", "codemem.ps1", "codemem"].some((file) => fs.existsSync(path.join(binDir, file)));
}

function pathOnEnv(binDir) {
  const entries = String(process.env.PATH || "").split(path.delimiter).map((entry) => path.resolve(entry).toLowerCase());
  return entries.includes(path.resolve(binDir).toLowerCase());
}

function check(name, ok, detail) {
  return { name, ok: Boolean(ok), detail };
}

function pathInstructions(binDir) {
  return {
    powershell_current_user: `[Environment]::SetEnvironmentVariable("Path", $env:Path + ";${binDir}", "User")`,
    powershell_current_session: `$env:Path = "${binDir};$env:Path"`,
    bash_zsh: `export PATH="${binDir}:$PATH"`
  };
}
