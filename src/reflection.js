import path from "node:path";
import fs from "node:fs";
import { makeId, nowIso } from "./schema.js";
import { paths, readJson, saveMemory, writeJson } from "./storage.js";
import { loadSession } from "./session.js";
import { analyzeCandidate } from "./quality.js";

const HEURISTICS = [
  { type: "failed_attempt", pattern: /\b(failed|did not work|doesn't work|error|blocked|regression)\b/i },
  { type: "bug", pattern: /\b(bug|defect|broken|incorrect|crash|exception)\b/i },
  { type: "fix", pattern: /\b(fixed|resolved|patched|changed|implemented)\b/i },
  { type: "decision", pattern: /\b(decided|chose|because|tradeoff|instead)\b/i },
  { type: "convention", pattern: /\b(convention|pattern|always|prefer|style)\b/i },
  { type: "todo", pattern: /\b(todo|follow up|next|later|remaining)\b/i },
  { type: "warning", pattern: /\b(warning|careful|avoid|never|risk)\b/i }
];

export function splitNotes(notes) {
  return String(notes)
    .split(/\r?\n|(?<=[.!?])\s+/)
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter((line) => line.length >= 20);
}

export function extractCandidateMemories(notes, options = {}) {
  const createdAt = options.created_at || nowIso();
  const candidates = [];

  for (const sentence of splitNotes(notes)) {
    if (isLowSignalSentence(sentence)) continue;
    const match = HEURISTICS.find((heuristic) => heuristic.pattern.test(sentence));
    if (!match) continue;
    const cleaned = cleanSentence(sentence);
    if (!hasDurableSignal(cleaned, match.type)) continue;
    const title = makeCandidateTitle(cleaned, match.type);
    const confidence = confidenceFor(sentence, match.type);
    candidates.push({
      id: makeId(match.type, title, createdAt),
      type: match.type,
      title,
      created_at: createdAt,
      updated_at: createdAt,
      confidence,
      tags: options.tags || [],
      code_paths: [...new Set([...findCodePaths(sentence), ...(options.code_paths || [])])],
      source: "reflection",
      body: cleaned,
      rationale: inferRationale(cleaned),
      next_time: inferNextTime(cleaned, match.type),
      status: confidence >= 0.9 ? "auto_approvable" : "pending"
    });
  }

  return dedupe(candidates);
}

function isLowSignalSentence(sentence) {
  const text = sentence.trim();
  if (/^the fix touched .+ because (validated|tested|prepared|completed|ran|verified)\b/i.test(text)) return true;
  if (/^touched file .+ while implementing /i.test(text)) return true;
  if (/^error:\s*(no error|none|n\/a)/i.test(text)) return true;
  if (/^final outcome:\s*(validated|tested|verified|prepared|completed)\s+(session|reflection|prompt|context|workflow)\b/i.test(text)) return true;
  if (/^(validated|tested|verified|prepared|completed)\s+(session|reflection|prompt|context|workflow)\b/i.test(text)) return true;
  return [
    /^changed file:/i,
    /^command run:/i,
    /^git commit:/i,
    /^task:/i,
    /^request:/i,
    /^final outcome:\s*$/i,
    /^note:\s*$/i
  ].some((pattern) => pattern.test(text));
}

function cleanSentence(sentence) {
  return sentence
    .replace(/^Note:\s*/i, "")
    .replace(/^Final outcome:\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasDurableSignal(sentence, type) {
  if (sentence.length < 24) return false;
  if (/^(validated|tested|prepared|completed|ran|verified)\b/i.test(sentence) && !/\bbecause\b/i.test(sentence)) return false;
  if (/\bsomething happened\b/i.test(sentence)) return false;
  if (type === "decision") return /\b(decided|chose|because|prefer|use|register|store|keep|route)\b/i.test(sentence);
  if (type === "failed_attempt") return /\b(failed|requires|avoid|blocked|error|did not work)\b/i.test(sentence);
  return true;
}

function makeCandidateTitle(sentence, type) {
  const because = sentence.match(/^(.+?)\s+because\s+(.+)$/i);
  const base = because ? because[1] : sentence;
  const prefix = type === "failed_attempt" ? "Remember failure: " : "";
  return `${prefix}${base}`.replace(/\s+/g, " ").slice(0, 90).replace(/[.,;:]$/, "");
}

function confidenceFor(sentence, type) {
  let confidence = 0.62;
  if (/\bbecause\b/i.test(sentence)) confidence += 0.12;
  if (findCodePaths(sentence).length > 0) confidence += 0.1;
  if (["warning", "convention"].includes(type) && /\b(always|never|prefer|avoid)\b/i.test(sentence)) confidence += 0.1;
  return Math.min(0.95, confidence);
}

function findCodePaths(text) {
  return [...new Set(String(text).match(/\b(?:src|tests|lib|app|packages|docs)\/[A-Za-z0-9_./-]+/g) || [])];
}

function inferRationale(sentence) {
  const because = sentence.match(/\bbecause\b(.+)$/i);
  if (because) return `Reason captured from task notes: ${because[1].trim()}`;
  return "Captured as durable task knowledge during reflection.";
}

function inferNextTime(sentence, type) {
  const normalized = sentence.replace(/\s+/g, " ").replace(/[.]+$/, "");
  const because = normalized.match(/^(.+?)\s+because\s+(.+)$/i);
  if (type === "failed_attempt") {
    return because ? `Do not repeat this failure: ${because[1]} because ${because[2]}.` : `Avoid this failure mode: ${normalized}.`;
  }
  if (type === "bug") return `Check for this bug pattern: ${normalized}.`;
  if (type === "fix") return `Reuse this fix pattern when relevant: ${normalized}.`;
  if (type === "todo") return `Follow up: ${normalized}.`;
  if (because) return `${because[1]} because ${because[2]}.`;
  return normalized.endsWith(".") ? normalized : `${normalized}.`;
}

function dedupe(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = `${candidate.type}:${candidate.body.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function createReflection(notes, { root = process.cwd(), task = "Task reflection", approveHighConfidence = false, codePaths = [] } = {}) {
  const p = paths(root);
  const createdAt = nowIso();
  const candidates = extractCandidateMemories(notes, { created_at: createdAt, code_paths: codePaths });
  const baseId = `reflection-${createdAt.replace(/[-:TZ.]/g, "").slice(0, 14)}`;
  const reflection = {
    id: uniqueReflectionId(p, baseId),
    task,
    created_at: createdAt,
    summary: summarize(notes),
    source: "notes",
    candidates
  };

  writeJson(path.join(p.reflections, `${reflection.id}.json`), reflection);

  const pending = [];
  const approved = [];
  for (const candidate of candidates) {
    if (approveHighConfidence && candidate.status === "auto_approvable") {
      approved.push(saveMemory(candidate, root));
    } else {
      pending.push(candidate);
    }
  }

  if (pending.length > 0) {
    writeJson(path.join(p.pending, `${reflection.id}.json`), { reflection_id: reflection.id, candidates: pending });
  }

  return { reflection, pending, approved };
}

export function createReflectionFromSession(sessionRef, { root = process.cwd(), approveHighConfidence = false } = {}) {
  const session = loadSession(sessionRef, root);
  const notes = sessionToReflectionText(session);
  const result = createReflection(notes, {
    root,
    task: session.task,
    approveHighConfidence,
    codePaths: session.files_changed || []
  });
  result.reflection.source = "session";
  result.reflection.session_id = session.id;
  result.reflection.session_file = session.file_path;
  result.reflection.session = {
    id: session.id,
    task: session.task,
    status: session.status,
    files_changed: session.files_changed,
    commands_run: session.commands_run,
    errors: session.errors,
    final_outcome: session.final_outcome,
    git_commit: session.git_commit
  };
  const p = paths(root);
  writeJson(path.join(p.reflections, `${result.reflection.id}.json`), result.reflection);
  if (result.pending.length > 0) {
    writeJson(path.join(p.pending, `${result.reflection.id}.json`), {
      reflection_id: result.reflection.id,
      source: "session",
      session_id: session.id,
      candidates: result.pending
    });
  }
  return result;
}

export function sessionToReflectionText(session) {
  const lines = [
    `Task: ${session.task}`,
    session.request ? `Request: ${session.request}` : "",
    session.final_outcome ? `Final outcome: ${session.final_outcome}` : "",
    session.git_commit ? `Git commit: ${session.git_commit}` : ""
  ].filter(Boolean);

  for (const note of session.notes || []) {
    lines.push(`Note: ${typeof note === "string" ? note : note.text}`);
  }
  for (const file of session.files_changed || []) {
    lines.push(`File touched for context only: ${file}`);
  }
  for (const command of session.commands_run || []) {
    const text = formatCommandForReflection(command);
    lines.push(`Command run: ${text}`);
    const failure = commandFailureForReflection(command);
    if (failure) lines.push(`Error: ${failure}`);
  }
  for (const error of session.errors || []) {
    lines.push(`Error: ${typeof error === "string" ? error : error.text}`);
  }

  if ((session.errors || []).length > 0) {
    lines.push("A failed attempt occurred during this session because recorded errors changed the implementation path.");
  }
  return lines.join("\n");
}

function formatCommandForReflection(command) {
  if (typeof command === "string") return command;
  const status = command.status || "recorded";
  return `${command.command} (${status})`;
}

function commandFailureForReflection(command) {
  if (typeof command === "string" || !command || command.status !== "failed") return "";
  const firstLine = String(command.output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return "A recorded command failed without diagnostic output.";
  return firstLine.slice(0, 240);
}

function summarize(notes) {
  const sentences = splitNotes(notes).slice(0, 3);
  return sentences.length ? sentences.join(" ") : String(notes).trim().slice(0, 500);
}

export function formatPendingReview(filePath) {
  const pending = readJson(filePath);
  const lines = [`Review: ${pending.reflection_id || path.basename(filePath)}`, ""];
  pending.candidates.forEach((candidate, idx) => {
    lines.push(`${idx + 1}. ${candidate.title}`);
    lines.push(`   type: ${candidate.type}`);
    lines.push(`   status: ${candidate.review_status || candidate.status || "pending"}`);
    lines.push(`   confidence: ${Number(candidate.confidence || 0).toFixed(2)}`);
    lines.push(`   rationale: ${candidate.rationale || ""}`);
    lines.push(`   next time: ${candidate.next_time || ""}`);
    lines.push(`   files: ${(candidate.code_paths || []).join(", ") || "none"}`);
    if (candidate.duplicates?.length) lines.push(`   duplicates: ${candidate.duplicates.map((item) => item.title).join("; ")}`);
    if (candidate.conflicts?.length) lines.push(`   conflicts: ${candidate.conflicts.map((item) => item.title).join("; ")}`);
    lines.push("");
  });
  return lines.join("\n").trimEnd();
}

export function latestPendingReviewFile(root = process.cwd()) {
  const p = paths(root);
  if (!fs.existsSync(p.pending)) return "";
  const files = fs.readdirSync(p.pending)
    .filter((file) => file.endsWith(".json"))
    .map((file) => path.join(p.pending, file))
    .filter((filePath) => hasPendingCandidates(filePath))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0] || "";
}

export function approvePending(filePath, { root = process.cwd(), indices = [], reject = [], approveAll = false, rejectAll = false } = {}) {
  const pending = readJson(filePath);
  if (!Array.isArray(pending.candidates)) {
    throw new Error("Malformed pending review file: expected candidates array.");
  }

  const approveSet = approveAll ? new Set(pending.candidates.map((_, idx) => idx + 1)) : new Set(indices);
  const rejectSet = rejectAll ? new Set(pending.candidates.map((_, idx) => idx + 1)) : new Set(reject);
  const approved = [];
  let rejected = 0;

  pending.candidates = pending.candidates.map((candidate, idx) => {
    const number = idx + 1;
    if (rejectSet.has(number)) {
      rejected += 1;
      return { ...candidate, review_status: "rejected", reviewed_at: nowIso() };
    }
    if (approveSet.has(number) && candidate.review_status !== "approved") {
      const analysis = analyzeCandidate(candidate, root);
      if (analysis.duplicates.length > 0) {
        return {
          ...candidate,
          review_status: "duplicate",
          duplicates: analysis.duplicates.map(toReviewReference),
          reviewed_at: nowIso()
        };
      }
      const saved = saveMemory({ ...candidate, status: undefined, review_status: undefined }, root);
      approved.push(saved);
      return {
        ...candidate,
        review_status: analysis.conflicts.length ? "approved_with_conflict" : "approved",
        conflicts: analysis.conflicts.map(toReviewReference),
        approved_memory_id: saved.id,
        reviewed_at: nowIso()
      };
    }
    return candidate;
  });

  writeJson(filePath, pending);
  return { approved, rejected, count: approved.length };
}

function toReviewReference(memory) {
  return {
    id: memory.id,
    title: memory.title,
    type: memory.type,
    file_path: memory.file_path
  };
}

function hasPendingCandidates(filePath) {
  try {
    const pending = readJson(filePath);
    return Array.isArray(pending.candidates) && pending.candidates.some((candidate) => !candidate.review_status || candidate.review_status === "pending" || candidate.status === "pending");
  } catch {
    return false;
  }
}

function uniqueReflectionId(p, baseId) {
  const exists = (id) => fs.existsSync(path.join(p.reflections, `${id}.json`)) || fs.existsSync(path.join(p.pending, `${id}.json`));
  if (!exists(baseId)) return baseId;
  for (let idx = 2; idx < 1000; idx += 1) {
    const candidate = `${baseId}-${idx}`;
    if (!exists(candidate)) return candidate;
  }
  throw new Error(`Could not create unique reflection id for ${baseId}`);
}
