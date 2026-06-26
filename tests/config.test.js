import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureConfig, readConfig, writeConfig } from "../src/config.js";

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ContextBrain-"));
}

test("config is created with local-first defaults", () => {
  const root = tempRepo();
  const filePath = ensureConfig(root);
  const config = readConfig(root);

  assert.equal(fs.existsSync(filePath), true);
  assert.equal(config.agentCommand, "codex exec");
  assert.equal(config.resumeCommand, "codex resume --last");
  assert.equal(config.autoReflect, true);
});

test("config updates preserve defaults for empty values", () => {
  const root = tempRepo();
  const config = writeConfig({
    agentCommand: "codex exec --sandbox read-only",
    resumeCommand: "",
    autoReflect: false
  }, root);

  assert.equal(config.agentCommand, "codex exec --sandbox read-only");
  assert.equal(config.resumeCommand, "codex resume --last");
  assert.equal(config.autoReflect, false);
});
