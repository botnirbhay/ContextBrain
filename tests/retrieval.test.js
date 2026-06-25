import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveMemory } from "../src/storage.js";
import { formatInjection, searchMemories } from "../src/retrieval.js";

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "CodeMem-"));
}

test("search ranks code-linked relevant memories first", () => {
  const root = tempRepo();
  saveMemory({
    type: "decision",
    title: "Use markdown storage",
    body: "Memory records live in markdown files with frontmatter.",
    code_paths: ["src/storage.js"],
    confidence: 0.9
  }, root);
  saveMemory({
    type: "todo",
    title: "Improve release notes",
    body: "Add a release checklist later.",
    confidence: 0.5
  }, root);

  const results = searchMemories("change src/storage.js markdown memory format", { root, limit: 2 });
  assert.equal(results[0].memory.title, "Use markdown storage");
  assert.ok(results[0].reasons.includes("matches a linked code path"));
});

test("inject output is capped and explainable", () => {
  const root = tempRepo();
  for (let i = 0; i < 4; i += 1) {
    saveMemory({
      type: "lesson",
      title: `Memory lesson ${i}`,
      body: "Reflection should capture durable memory knowledge.",
      confidence: 0.8
    }, root);
  }

  const injection = formatInjection(searchMemories("durable memory reflection", { root, limit: 4 }), { maxItems: 2 });
  assert.match(injection, /Why included:/);
  assert.equal((injection.match(/^## /gm) || []).length, 2);
});
