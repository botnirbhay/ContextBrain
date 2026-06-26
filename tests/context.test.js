import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildContextPack, buildCodexPrompt, formatContextPack } from "../src/context.js";
import { searchMemories } from "../src/retrieval.js";
import { saveMemory } from "../src/storage.js";

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ContextBrain-"));
}

test("context generation groups memories for Codex", () => {
  const root = tempRepo();
  saveMemory({ type: "decision", title: "Use Zod validation", body: "Use Zod for input validation.", next_time: "Use Zod validation.", confidence: 0.8 }, root);
  saveMemory({ type: "bug", title: "OAuth redirect bug", body: "OAuth redirects failed when callback URLs were not normalized.", next_time: "Normalize callback URLs.", confidence: 0.8 }, root);
  saveMemory({ type: "failed_attempt", title: "Avoid raw token storage", body: "Storing OAuth tokens in plaintext failed security review.", next_time: "Do not store OAuth tokens in plaintext.", confidence: 0.8 }, root);

  const pack = buildContextPack("implement oauth login with callback validation", { root });
  const text = formatContextPack(pack);
  assert.match(text, /Relevant Decisions:/);
  assert.match(text, /Relevant Bugs:/);
  assert.match(text, /Relevant Failed Attempts:/);
});

test("prompt generation includes exact task and context", () => {
  const root = tempRepo();
  saveMemory({ type: "convention", title: "Register CLI commands in cli.js", body: "CLI commands are registered in src/cli.js.", next_time: "Update src/cli.js for new commands.", code_paths: ["src/cli.js"] }, root);
  const { prompt } = buildCodexPrompt("add a new cli command", { root });
  assert.match(prompt, /Task: add a new cli command/);
  assert.match(prompt, /Relevant Decisions:/);
});

test("used memories gain usefulness and affect ranking", () => {
  const root = tempRepo();
  const memory = saveMemory({ type: "lesson", title: "Useful CLI lesson", body: "CLI prompts should include memory context.", confidence: 0.6 }, root);
  buildContextPack("CLI memory context", { root, markUsed: true });
  const [result] = searchMemories("CLI memory context", { root, limit: 1 });
  assert.equal(result.memory.id, memory.id);
  assert.equal(result.memory.used_count, 1);
  assert.ok(result.memory.usefulness > 0.6);
});
