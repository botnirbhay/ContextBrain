import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  approvePending,
  createReflection,
  createReflectionFromSession,
  extractCandidateMemories,
  formatPendingReview
} from "../src/reflection.js";
import { addSessionError, addSessionFile, addSessionNote, endSession, startSession } from "../src/session.js";
import { listMemories, saveMemory } from "../src/storage.js";

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "codexmemory-"));
}

test("reflection extracts durable candidate memories from task notes", () => {
  const candidates = extractCandidateMemories(`
    We decided to keep storage in src/storage.js because markdown is easy to review.
    The first parser failed because it silently dropped code_paths.
    Random timing details from the session are not important.
  `);

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].type, "decision");
  assert.equal(candidates[1].type, "failed_attempt");
  assert.deepEqual(candidates[0].code_paths, ["src/storage.js"]);
});

test("reflection writes pending proposals and review approves them", () => {
  const root = tempRepo();
  const result = createReflection("We fixed src/retrieval.js because code-linked memories should rank higher.", {
    root,
    task: "Ranking fix"
  });

  assert.equal(result.pending.length, 1);
  const pendingFile = path.join(root, ".codexmemory", "reflections", "pending", `${result.reflection.id}.json`);
  assert.equal(fs.existsSync(pendingFile), true);

  const approved = approvePending(pendingFile, { root, approveAll: true });
  assert.equal(approved.count, 1);
  assert.equal(listMemories(root).length, 1);
});

test("reflection can be created from a structured session file", () => {
  const root = tempRepo();
  const session = startSession({ task: "Session reflection", request: "capture structured data" }, root);
  addSessionNote("We decided to record files_changed because reflection needs linked files.", root);
  addSessionFile("src/session.js", root);
  addSessionError("The first session parser failed because malformed JSON was not validated.", root);
  const ended = endSession({ summary: "Implemented session reflection because durable learnings should come from session data." }, root);

  const result = createReflectionFromSession(ended.file_path, { root });
  assert.equal(result.reflection.source, "session");
  assert.equal(result.reflection.session_id, session.id);
  assert.ok(result.pending.length >= 2);
  assert.ok(result.pending.some((candidate) => candidate.code_paths.includes("src/session.js")));
});

test("review shows details and supports approve and reject", () => {
  const root = tempRepo();
  const result = createReflection("We fixed src/retrieval.js because ranking should explain linked files. Avoid repeating the failed scoring attempt.", {
    root,
    task: "Review UX"
  });
  const pendingFile = path.join(root, ".codexmemory", "reflections", "pending", `${result.reflection.id}.json`);

  const reviewText = formatPendingReview(pendingFile);
  assert.match(reviewText, /confidence:/);
  assert.match(reviewText, /next time:/);

  const reviewed = approvePending(pendingFile, { root, indices: [1], reject: [2] });
  assert.equal(reviewed.count, 1);
  assert.equal(reviewed.rejected, 1);
  assert.equal(listMemories(root).length, 1);

  const pending = JSON.parse(fs.readFileSync(pendingFile, "utf8"));
  assert.equal(pending.candidates[0].review_status, "approved");
  assert.equal(pending.candidates[1].review_status, "rejected");
});

test("reflection avoids vague changed-file memories", () => {
  const candidates = extractCandidateMemories(`
    Changed file: src/cli.js
    File touched for context only: src/cli.js
    The fix touched src/cli.js because Validated session reflection because durable learnings should come from structured task records.
    Something happened during the session.
    We decided to register CLI commands in src/cli.js because command routing belongs there.
  `);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].title.includes("Changed file"), false);
  assert.match(candidates[0].next_time, /register CLI commands/i);
});

test("review blocks duplicates and surfaces conflicts", () => {
  const root = tempRepo();
  saveMemory({
    type: "decision",
    title: "Use Prisma",
    body: "Use Prisma for persistence.",
    next_time: "Use Prisma for persistence.",
    confidence: 0.8
  }, root);

  const duplicate = createReflection("We decided to use Prisma for persistence because the schema is already modeled there.", {
    root,
    task: "Duplicate"
  });
  const duplicateFile = path.join(root, ".codexmemory", "reflections", "pending", `${duplicate.reflection.id}.json`);
  const duplicateReview = approvePending(duplicateFile, { root, approveAll: true });
  assert.equal(duplicateReview.count, 0);
  const duplicatePending = JSON.parse(fs.readFileSync(duplicateFile, "utf8"));
  assert.equal(duplicatePending.candidates[0].review_status, "duplicate");

  const conflict = createReflection("We decided to remove Prisma because local file storage is simpler.", {
    root,
    task: "Conflict"
  });
  const conflictFile = path.join(root, ".codexmemory", "reflections", "pending", `${conflict.reflection.id}.json`);
  const conflictReview = approvePending(conflictFile, { root, approveAll: true });
  assert.equal(conflictReview.count, 1);
  const conflictPending = JSON.parse(fs.readFileSync(conflictFile, "utf8"));
  assert.equal(conflictPending.candidates[0].review_status, "approved_with_conflict");
  assert.ok(conflictPending.candidates[0].conflicts.length >= 1);
});
