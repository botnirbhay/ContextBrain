import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initStore, listMemories, saveMemory } from "../src/storage.js";

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "codexmemory-"));
}

test("init creates repo-local memory directories", () => {
  const root = tempRepo();
  const p = initStore(root);
  assert.equal(fs.existsSync(p.memories), true);
  assert.equal(fs.existsSync(p.sessions), true);
  assert.equal(fs.existsSync(p.reflections), true);
  assert.equal(fs.existsSync(p.indexes), true);
});

test("save writes a human-readable markdown memory", () => {
  const root = tempRepo();
  const memory = saveMemory({
    type: "decision",
    title: "Use local markdown records",
    body: "Store durable memories as markdown with frontmatter.",
    rationale: "Humans can edit the records in normal review tools.",
    next_time: "Prefer markdown records for v1 memory storage.",
    code_paths: ["src/storage.js"],
    tags: ["storage"]
  }, root);

  const text = fs.readFileSync(memory.file_path, "utf8");
  assert.match(text, /type: "decision"/);
  assert.match(text, /# Use local markdown records/);

  const memories = listMemories(root);
  assert.equal(memories.length, 1);
  assert.equal(memories[0].type, "decision");
  assert.deepEqual(memories[0].code_paths, ["src/storage.js"]);
});

test("save refuses to overwrite an existing memory id", () => {
  const root = tempRepo();
  const input = {
    id: "fixed-id",
    type: "lesson",
    title: "Keep memory durable",
    body: "Only keep durable project knowledge."
  };
  saveMemory(input, root);
  assert.throws(() => saveMemory(input, root), /already exists/);
});
