import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { continueWorkflow, getWorkflowStatus, runWorkflow } from "../src/runner.js";
import { saveMemory } from "../src/storage.js";
import { execFileSync } from "node:child_process";

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "codexmemory-"));
}

test("run workflow prepares prompt, session, reflection, and avoids Codex in dry-run", () => {
  const root = tempRepo();
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  fs.writeFileSync(path.join(root, "changed.js"), "console.log('changed');\n");
  saveMemory({ type: "decision", title: "CLI commands live in cli.js", body: "CLI commands are registered in src/cli.js.", next_time: "Update src/cli.js for commands.", code_paths: ["src/cli.js"] }, root);

  const result = runWorkflow("add oauth cli command", { root, dryRun: true });
  assert.equal(result.launch.status, "dry-run");
  assert.equal(fs.existsSync(result.promptPath), true);
  assert.equal(fs.existsSync(result.contextPath), true);
  assert.ok(result.reflection.reflection.id);

  const status = getWorkflowStatus({ root });
  assert.equal(status.last.id, result.session.id);
  assert.ok(status.memories_used.length >= 1);
  assert.ok(status.files_touched.includes("changed.js"));
});

test("continue workflow resumes last session and prepares a prompt", () => {
  const root = tempRepo();
  const first = runWorkflow("implement continue workflow", { root, dryRun: true, autoReflect: false });
  const continued = continueWorkflow({ root, dryRun: true });
  assert.equal(continued.session.id, first.session.id);
  assert.equal(fs.existsSync(continued.promptPath), true);
});
