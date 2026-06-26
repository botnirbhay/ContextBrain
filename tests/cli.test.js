import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ContextBrain-"));
}

test("cli core commands work without API keys", () => {
  const root = tempRepo();
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  delete env.ANTHROPIC_API_KEY;

  const cli = path.resolve("src/cli.js");
  const output = execFileSync(process.execPath, [cli, "init"], { cwd: root, env, encoding: "utf8" });
  assert.match(output, /Initialized ContextBrain/);

  const started = execFileSync(process.execPath, [cli, "session", "start", "--task", "No key session"], { cwd: root, env, encoding: "utf8" });
  assert.match(started, /Started session/);

  execFileSync(process.execPath, [cli, "session", "note", "We fixed src/cli.js because local CLI usage must not require keys."], { cwd: root, env });
  execFileSync(process.execPath, [cli, "session", "add-file", "src/cli.js"], { cwd: root, env });
  execFileSync(process.execPath, [cli, "session", "stop", "--summary", "No-key local flow works because all features use local files."], { cwd: root, env });

  const sessionFile = fs.readdirSync(path.join(root, ".contextbrain", "sessions")).find((file) => file.endsWith(".json") && file !== "current.json");
  const reflected = execFileSync(process.execPath, [cli, "reflect", "--session", path.join(root, ".contextbrain", "sessions", sessionFile)], {
    cwd: root,
    env,
    encoding: "utf8"
  });
  assert.match(reflected, /Proposed memories pending review:/);
});

test("cli config, latest review, and verify workflows work", () => {
  const root = tempRepo();
  const env = { ...process.env };
  const cli = path.resolve("src/cli.js");

  const configured = execFileSync(process.execPath, [cli, "config", "--agent-command", "codex exec --sandbox read-only", "--resume-command", "codex resume --last --include-non-interactive"], {
    cwd: root,
    env,
    encoding: "utf8"
  });
  assert.match(configured, /agentCommand: codex exec --sandbox read-only/);
  assert.match(configured, /resumeCommand: codex resume --last --include-non-interactive/);

  const verify = execFileSync(process.execPath, [cli, "verify"], { cwd: root, env, encoding: "utf8" });
  assert.match(verify, /Dry-run workflow: OK/);

  const reflection = execFileSync(process.execPath, [cli, "reflect", "--body", "We decided to keep review latest because pending file paths are noisy."], {
    cwd: root,
    env,
    encoding: "utf8"
  });
  assert.match(reflection, /Proposed memories pending review: 1/);

  const review = execFileSync(process.execPath, [cli, "review"], { cwd: root, env, encoding: "utf8" });
  assert.match(review, /Review:/);
  assert.match(review, /pending file paths are noisy/);
});
