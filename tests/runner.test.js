import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { continueWorkflow, getWorkflowStatus, preparePrompt, resumeWorkflow, runWorkflow } from "../src/runner.js";
import { saveMemory } from "../src/storage.js";
import { execFileSync } from "node:child_process";

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "CodeMem-"));
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

test("prompt artifacts do not silently overwrite within the same second", () => {
  const root = tempRepo();
  const first = preparePrompt("first task", { root });
  const second = preparePrompt("second task", { root });

  assert.notEqual(first.promptPath, second.promptPath);
  assert.notEqual(first.contextPath, second.contextPath);
  assert.match(fs.readFileSync(first.promptPath, "utf8"), /Task: first task/);
  assert.match(fs.readFileSync(second.promptPath, "utf8"), /Task: second task/);
});

test("continue workflow resumes last session and prepares a prompt", () => {
  const root = tempRepo();
  const first = runWorkflow("implement continue workflow", { root, dryRun: true, autoReflect: false });
  const continued = continueWorkflow({ root, dryRun: true });
  assert.equal(continued.session.id, first.session.id);
  assert.equal(fs.existsSync(continued.promptPath), true);
});

test("resume workflow reuses last session and prepares a resume prompt", () => {
  const root = tempRepo();
  const first = runWorkflow("implement oauth login", { root, dryRun: true, autoReflect: false });
  const resumed = resumeWorkflow("continue with tests", { root, dryRun: true, autoReflect: false });

  assert.equal(resumed.session.id, first.session.id);
  assert.equal(fs.existsSync(resumed.promptPath), true);
  assert.match(fs.readFileSync(resumed.promptPath, "utf8"), /Task: continue with tests/);
});

test("resume workflow passes prompt as agent resume argument", () => {
  const root = tempRepo();
  runWorkflow("inspect project structure", { root, dryRun: true, autoReflect: false });
  const outFile = path.join(root, "resume-args.json");
  const script = path.join(root, "capture-args.js");
  fs.writeFileSync(script, `const fs = require("node:fs"); fs.writeFileSync(${JSON.stringify(outFile)}, JSON.stringify(process.argv.slice(2)));`);

  const result = resumeWorkflow("follow up on project structure", {
    root,
    agentCommand: `"${process.execPath}" "${script}" resume --last`,
    autoReflect: false
  });

  const args = JSON.parse(fs.readFileSync(outFile, "utf8"));
  assert.equal(result.session.task, "inspect project structure");
  assert.deepEqual(args.slice(0, 2), ["resume", "--last"]);
  assert.match(args.at(-1), /Task: follow up on project structure/);
  assert.equal(result.launch.status, "completed");
});

test("run workflow sends prompt through stdin to avoid shell argument splitting", () => {
  const root = tempRepo();
  const script = path.join(root, "read-stdin.js");
  fs.writeFileSync(script, "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{if(!d.includes('Task: inspect project structure')) process.exit(3); console.log('stdin-ok')});\n");
  const result = runWorkflow("inspect project structure", {
    root,
    codexCommand: `"${process.execPath}" "${script}"`
  });

  assert.equal(result.launch.status, "completed");
  assert.match(result.launch.stdout, /stdin-ok/);
});
