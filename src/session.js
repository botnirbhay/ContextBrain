import fs from "node:fs";
import path from "node:path";
import { nowIso, slugify } from "./schema.js";
import { initStore, paths, readJson, writeJson } from "./storage.js";

const CURRENT_FILE = "current.json";

export function startSession({ task = "Untitled task", request = "" } = {}, root = process.cwd()) {
  const p = initStore(root);
  const currentPath = path.join(p.sessions, CURRENT_FILE);
  if (fs.existsSync(currentPath)) {
    const current = readJson(currentPath);
    throw new Error(`A session is already active: ${current.id}`);
  }

  const createdAt = nowIso();
  const session = {
    id: `${createdAt.replace(/[-:TZ.]/g, "").slice(0, 14)}-${slugify(task)}`,
    task,
    request,
    status: "active",
    started_at: createdAt,
    ended_at: null,
    notes: [],
    files_changed: [],
    commands_run: [],
    errors: [],
    final_outcome: "",
    git_commit: "",
    memories_used: [],
    context_pack_file: "",
    prompt_file: "",
    git_diff_summary: ""
  };

  const filePath = path.join(p.sessions, `${session.id}.json`);
  writeJson(filePath, session);
  writeJson(currentPath, { id: session.id, file_path: filePath });
  return { ...session, file_path: filePath };
}

export function getCurrentSession(root = process.cwd()) {
  const p = paths(root);
  const currentPath = path.join(p.sessions, CURRENT_FILE);
  if (!fs.existsSync(currentPath)) {
    return null;
  }
  const current = readJson(currentPath);
  if (!fs.existsSync(current.file_path)) {
    return null;
  }
  return { ...readJson(current.file_path), file_path: current.file_path };
}

export function loadSession(sessionRef, root = process.cwd()) {
  const p = paths(root);
  if (!sessionRef) {
    const current = getCurrentSession(root);
    if (!current) {
      throw new Error("No active session and no session id or file was provided.");
    }
    return validateSession(current);
  }

  const candidates = [
    path.resolve(root, sessionRef),
    path.join(p.sessions, sessionRef),
    path.join(p.sessions, `${sessionRef}.json`)
  ];
  const filePath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!filePath) {
    throw new Error(`Session not found: ${sessionRef}`);
  }
  return validateSession({ ...readJson(filePath), file_path: filePath });
}

export function validateSession(session) {
  if (!session || typeof session !== "object") {
    throw new Error("Malformed session: expected a JSON object.");
  }
  for (const field of ["id", "task", "status", "started_at"]) {
    if (!session[field] || typeof session[field] !== "string") {
      throw new Error(`Malformed session: missing string field "${field}".`);
    }
  }
  return {
    ...session,
    notes: Array.isArray(session.notes) ? session.notes : [],
    files_changed: Array.isArray(session.files_changed) ? session.files_changed : [],
    commands_run: Array.isArray(session.commands_run) ? session.commands_run : [],
    errors: Array.isArray(session.errors) ? session.errors : []
  };
}

export function updateSessionRecord(session, root = process.cwd()) {
  const loaded = session.file_path ? session : loadSession(session.id, root);
  writeJson(loaded.file_path, stripFilePath({ ...loaded, ...session }));
  return { ...loaded, ...session };
}

export function addSessionNote(note, root = process.cwd()) {
  if (!note.trim()) {
    throw new Error("session note requires note text.");
  }
  const session = getCurrentSession(root);
  if (!session) {
    throw new Error("No active session. Run `codexmemory session start --task \"...\"` first.");
  }
  session.notes.push({ created_at: nowIso(), text: note.trim() });
  writeJson(session.file_path, stripFilePath(session));
  return session;
}

export function addSessionFile(file, root = process.cwd()) {
  if (!file.trim()) {
    throw new Error("session add-file requires a file path.");
  }
  const session = getActiveSession(root);
  const normalized = file.trim().replace(/\\/g, "/");
  if (!session.files_changed.includes(normalized)) {
    session.files_changed.push(normalized);
  }
  writeJson(session.file_path, stripFilePath(session));
  return session;
}

export function addSessionCommand(command, { status = "recorded", output = "" } = {}, root = process.cwd()) {
  if (!command.trim()) {
    throw new Error("session command requires command text.");
  }
  const session = getActiveSession(root);
  session.commands_run.push({ created_at: nowIso(), command: command.trim(), status, output });
  writeJson(session.file_path, stripFilePath(session));
  return session;
}

export function addSessionError(error, root = process.cwd()) {
  if (!error.trim()) {
    throw new Error("session error requires error text.");
  }
  const session = getActiveSession(root);
  session.errors.push({ created_at: nowIso(), text: error.trim() });
  writeJson(session.file_path, stripFilePath(session));
  return session;
}

export function endSession({ note = "", summary = "", outcome = "", commit = "" } = {}, root = process.cwd()) {
  const p = paths(root);
  const currentPath = path.join(p.sessions, CURRENT_FILE);
  const session = getActiveSession(root);
  if (note.trim()) {
    session.notes.push({ created_at: nowIso(), text: note.trim() });
  }
  session.final_outcome = summary || outcome || session.final_outcome || "";
  session.git_commit = commit || session.git_commit || "";
  session.status = "ended";
  session.ended_at = nowIso();
  writeJson(session.file_path, stripFilePath(session));
  fs.unlinkSync(currentPath);
  return session;
}

export function listSessions(root = process.cwd()) {
  const p = paths(root);
  if (!fs.existsSync(p.sessions)) {
    return [];
  }
  return fs.readdirSync(p.sessions)
    .filter((file) => file.endsWith(".json") && file !== CURRENT_FILE)
    .sort()
    .map((file) => {
      const filePath = path.join(p.sessions, file);
      return { ...readJson(filePath), file_path: filePath };
    })
    .filter((session) => session.id && session.task && session.status);
}

function getActiveSession(root) {
  const session = getCurrentSession(root);
  if (!session) {
    throw new Error("No active session. Run `codexmemory session start --task \"...\"` first.");
  }
  return validateSession(session);
}

function stripFilePath(session) {
  const { file_path, ...data } = session;
  return data;
}
