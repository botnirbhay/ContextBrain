import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { doctor, setupIntegration, uninstallIntegration } from "../src/setup.js";

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "CodeMem-"));
}

test("setup creates local wrappers and AGENTS bridge without external keys", () => {
  const root = tempRepo();
  const result = setupIntegration({ root });

  assert.equal(fs.existsSync(path.join(root, ".codemem", "bin", "codemem.cmd")), true);
  assert.equal(fs.existsSync(path.join(root, ".codemem", "bin", "codemem.ps1")), true);
  assert.equal(fs.existsSync(path.join(root, ".codemem", "bin", "codemem")), true);
  assert.equal(fs.existsSync(path.join(root, "AGENTS.md")), true);
  assert.equal(fs.existsSync(path.join(root, ".codemem", "AGENTS.md")), true);
  assert.match(fs.readFileSync(path.join(root, "AGENTS.md"), "utf8"), /codemem "<task description>"/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, ".codemem", "bin", "codemem.cmd"), "utf8"), / agent %\*/);
  assert.match(fs.readFileSync(path.join(root, ".codemem", "bin", "codemem.cmd"), "utf8"), /codemem\.js/);
  assert.match(result.path_instructions.powershell_current_session, /\.codemem/);
});

test("setup does not overwrite existing AGENTS.md", () => {
  const root = tempRepo();
  fs.writeFileSync(path.join(root, "AGENTS.md"), "# Existing Rules\n");
  const result = setupIntegration({ root });

  assert.equal(fs.readFileSync(path.join(root, "AGENTS.md"), "utf8"), "# Existing Rules\n");
  assert.equal(result.agent_bridge.status, "existing-agents-left-unchanged");
  assert.equal(fs.existsSync(result.agent_bridge.snippet_path), true);
});

test("doctor reports environment checks", () => {
  const root = tempRepo();
  setupIntegration({ root });
  const checks = doctor({ root });

  assert.ok(checks.some((check) => check.name === "Node.js >= 20" && check.ok));
  assert.ok(checks.some((check) => check.name === "codemem wrapper installed" && check.ok));
});

test("uninstall removes only generated setup files", () => {
  const root = tempRepo();
  setupIntegration({ root });
  const result = uninstallIntegration({ root });

  assert.ok(result.removed.some((file) => file.endsWith("codemem.cmd")));
  assert.equal(fs.existsSync(path.join(root, "AGENTS.md")), false);
  assert.equal(fs.existsSync(path.join(root, ".codemem", "AGENTS.md")), true);
});

test("codemem executable entry runs the CodeMem workflow", () => {
  const root = tempRepo();
  const output = execFileSync(process.execPath, [path.resolve("src/codemem.js"), "implement oauth login", "--dry-run"], {
    cwd: root,
    encoding: "utf8"
  });

  assert.match(output, /Session:/);
  assert.match(output, /Agent launch: dry-run/);
});

test("codemem executable entry passes known subcommands through", () => {
  const root = tempRepo();
  const output = execFileSync(process.execPath, [path.resolve("src/codemem.js"), "setup"], {
    cwd: root,
    encoding: "utf8"
  });

  assert.match(output, /CodeMem setup complete/);
  assert.equal(fs.existsSync(path.join(root, ".codemem", "bin", "codemem.cmd")), true);
});

