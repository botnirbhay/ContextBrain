import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateAgentsMarkdown, ruleFromMemory, writeAgentsFile } from "../src/learn.js";
import { saveMemory } from "../src/storage.js";

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ContextBrain-"));
}

test("learn generates AGENTS.md project rules from memories", () => {
  const root = tempRepo();
  saveMemory({ type: "decision", title: "Use Zod", body: "Use Zod validation.", next_time: "Use Zod validation.", confidence: 0.8 }, root);
  saveMemory({ type: "failed_attempt", title: "Avoid Redis pubsub", body: "Redis pub/sub caused missed local events.", next_time: "Avoid Redis pub/sub for local memory sync.", confidence: 0.8 }, root);

  const markdown = generateAgentsMarkdown({ root });
  assert.match(markdown, /# ContextBrain Project Instructions/);
  assert.match(markdown, /Use Zod validation/);
  assert.match(markdown, /Avoid Redis pub\/sub/);

  const filePath = writeAgentsFile({ root });
  assert.equal(fs.existsSync(filePath), true);
});

test("learn writes an explicit empty-memory state", () => {
  const root = tempRepo();
  const markdown = generateAgentsMarkdown({ root });
  assert.match(markdown, /No Approved Memories Yet/);
});

test("learn prefers concrete memory body over generic next-time guidance", () => {
  const rule = ruleFromMemory({
    title: "Note: We decided to register CLI commands",
    body: "We decided to register CLI commands in src/cli.js because command routing is centralized there.",
    rationale: "Reason captured from task notes: command routing is centralized there.",
    next_time: "Apply this context when a future task touches the same area."
  });
  assert.equal(rule, "We decided to register CLI commands in src/cli.js because command routing is centralized there.");
});
