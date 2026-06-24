import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { initStore, paths } from "./storage.js";
import { writeAgentsFile } from "./learn.js";

const WRAPPER_MARKER = "CODEXMEMORY_GENERATED_WRAPPER";
const AGENTS_MARKER = "CODEXMEMORY_GENERATED_AGENT_BRIDGE";

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
    check("Codex CLI available", commandExists("codex"), commandPath("codex") || "not found"),
    check("CodexMemory store initialized", fs.existsSync(p.base), p.base),
    check("codexm wrapper installed", wrapperExists(p.bin), p.bin),
    check("AGENTS.md bridge present", fs.existsSync(path.join(root, "AGENTS.md")), path.join(root, "AGENTS.md")),
    check(".codexmemory/AGENTS.md present", fs.existsSync(path.join(p.base, "AGENTS.md")), path.join(p.base, "AGENTS.md")),
    check(".codexmemory/bin on PATH", pathOnEnv(p.bin), p.bin)
  ];
}

export function formatDoctor(checks) {
  return checks.map((item) => `${item.ok ? "OK" : "WARN"} ${item.name}: ${item.detail}`).join("\n");
}

export function uninstallIntegration({ root = process.cwd() } = {}) {
  const p = paths(root);
  const removed = [];
  for (const file of ["codexm.cmd", "codexm.ps1", "codexm"]) {
    const filePath = path.join(p.bin, file);
    if (isGeneratedFile(filePath, WRAPPER_MARKER)) {
      fs.unlinkSync(filePath);
      removed.push(filePath);
    }
  }

  const agentsPath = path.join(root, "AGENTS.md");
  if (isGeneratedFile(agentsPath, AGENTS_MARKER)) {
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
      file: "codexm.cmd",
      content: [
        `@REM ${WRAPPER_MARKER}`,
        "@echo off",
        `node "${cliPath}" codex %*`
      ].join("\r\n") + "\r\n"
    },
    {
      file: "codexm.ps1",
      content: [
        `# ${WRAPPER_MARKER}`,
        `$CodexMemoryCli = "${normalizedCli}"`,
        "& node $CodexMemoryCli codex @args",
        "exit $LASTEXITCODE"
      ].join("\n") + "\n"
    },
    {
      file: "codexm",
      content: [
        `#!/usr/bin/env sh`,
        `# ${WRAPPER_MARKER}`,
        `node "${cliPath.replace(/"/g, '\\"')}" codex "$@"`
      ].join("\n") + "\n"
    }
  ];

  return wrappers.map((wrapper) => {
    const filePath = path.join(binDir, wrapper.file);
    writeGeneratedFile(filePath, wrapper.content, WRAPPER_MARKER, { force });
    if (wrapper.file === "codexm") {
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
    "# CodexMemory Integration",
    "",
    "This repository uses CodexMemory for persistent local project memory and task reflection.",
    "",
    "## How To Use Memory",
    "",
    "- Read `.codexmemory/AGENTS.md` for distilled project rules when it exists.",
    "- For task-specific context, run `codexmemory context \"<task description>\"` when the command is available.",
    "- Prefer current repository code over memory if they conflict, and mention the conflict before choosing.",
    "- Do not treat raw chat logs as memory. Durable memory should be decisions, conventions, bug fixes, failed attempts, lessons, warnings, or todos.",
    "",
    "## During Work",
    "",
    "- If a CodexMemory session is active, record durable notes with `codexmemory session note \"<durable note>\"`.",
    "- Record touched files with `codexmemory session add-file <path>` when useful.",
    "- At the end, summarize the durable outcome with `codexmemory session stop --summary \"<what changed and why>\"`.",
    "",
    "## Recommended User Entry Point",
    "",
    "Users normally run Codex through the CodexMemory wrapper:",
    "",
    "```bash",
    "codexm \"<task description>\"",
    "```",
    "",
    "This wrapper retrieves memory, prepares the Codex prompt, launches Codex, captures the outcome, and prepares reviewable learnings.",
    ""
  ].join("\n");

  if (fs.existsSync(filePath) && !isGeneratedFile(filePath, AGENTS_MARKER)) {
    const snippetPath = path.join(root, ".codexmemory", "AGENTS.bridge.md");
    fs.writeFileSync(snippetPath, content);
    return { status: "existing-agents-left-unchanged", file_path: filePath, snippet_path: snippetPath };
  }
  writeGeneratedFile(filePath, content, AGENTS_MARKER, { force });
  return { status: "installed", file_path: filePath };
}

function writeGeneratedFile(filePath, content, marker, { force }) {
  if (fs.existsSync(filePath) && !force && !isGeneratedFile(filePath, marker)) {
    throw new Error(`Refusing to overwrite non-CodexMemory file: ${filePath}`);
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function isGeneratedFile(filePath, marker) {
  return fs.existsSync(filePath) && fs.readFileSync(filePath, "utf8").includes(marker);
}

function getCliPath() {
  return fileURLToPath(new URL("./cli.js", import.meta.url));
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
  return ["codexm.cmd", "codexm.ps1", "codexm"].some((file) => fs.existsSync(path.join(binDir, file)));
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
