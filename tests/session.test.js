import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  addSessionCommand,
  addSessionError,
  addSessionFile,
  addSessionNote,
  endSession,
  getCurrentSession,
  listSessions,
  loadSession,
  startSession
} from "../src/session.js";

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ContextBrain-"));
}

test("session lifecycle writes current and session records", () => {
  const root = tempRepo();
  const started = startSession({ task: "Implement session CLI", request: "track work" }, root);

  assert.equal(started.status, "active");
  assert.equal(fs.existsSync(started.file_path), true);
  assert.equal(getCurrentSession(root).id, started.id);

  const noted = addSessionNote("Decided to store sessions as JSON records.", root);
  assert.equal(noted.notes.length, 1);
  const filed = addSessionFile("src/session.js", root);
  assert.deepEqual(filed.files_changed, ["src/session.js"]);
  const commanded = addSessionCommand("npm test", { status: "passed" }, root);
  assert.equal(commanded.commands_run[0].command, "npm test");
  const errored = addSessionError("The first stop command failed because the action was named end.", root);
  assert.equal(errored.errors.length, 1);

  const ended = endSession({
    note: "Session command tests passed.",
    summary: "Implemented session capture because reflection needs structured data.",
    commit: "abc123"
  }, root);
  assert.equal(ended.status, "ended");
  assert.equal(ended.notes.length, 2);
  assert.equal(ended.final_outcome, "Implemented session capture because reflection needs structured data.");
  assert.equal(ended.git_commit, "abc123");
  assert.equal(getCurrentSession(root), null);
  assert.equal(listSessions(root).length, 1);
});

test("starting a second session while one is active is rejected", () => {
  const root = tempRepo();
  startSession({ task: "First" }, root);
  assert.throws(() => startSession({ task: "Second" }, root), /already active/);
});

test("missing and malformed sessions are reported clearly", () => {
  const root = tempRepo();
  assert.throws(() => loadSession("missing-session", root), /Session not found/);

  const malformed = path.join(root, "bad-session.json");
  fs.writeFileSync(malformed, JSON.stringify({ id: "bad" }));
  assert.throws(() => loadSession(malformed, root), /Malformed session/);
});

test("session list orders by timestamps instead of filename", () => {
  const root = tempRepo();
  const sessionsDir = path.join(root, ".contextbrain", "sessions");
  fs.mkdirSync(sessionsDir, { recursive: true });
  const older = {
    id: "20260625183148-z-task",
    task: "z task",
    status: "ended",
    started_at: "2026-06-25T18:31:48.100Z",
    ended_at: "2026-06-25T18:31:48.200Z"
  };
  const newer = {
    id: "20260625183148-a-task",
    task: "a task",
    status: "ended",
    started_at: "2026-06-25T18:31:48.300Z",
    ended_at: "2026-06-25T18:31:48.400Z"
  };
  fs.writeFileSync(path.join(sessionsDir, `${older.id}.json`), `${JSON.stringify(older, null, 2)}\n`);
  fs.writeFileSync(path.join(sessionsDir, `${newer.id}.json`), `${JSON.stringify(newer, null, 2)}\n`);

  assert.equal(listSessions(root).at(-1).id, newer.id);
});
