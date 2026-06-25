import path from "node:path";
import { listMemories, updateMemory } from "./storage.js";
import { nowIso } from "./schema.js";

const TYPE_BOOSTS = {
  warning: 1.2,
  bug: 1.15,
  fix: 1.1,
  convention: 1.05,
  decision: 1.0,
  failed_attempt: 1.0,
  lesson: 1.0,
  todo: 0.95
};

export function tokenize(text) {
  return [...new Set(String(text).toLowerCase().match(/[a-z0-9_./-]{2,}/g) || [])];
}

export function scoreMemory(memory, query, now = new Date()) {
  const queryTokens = tokenize(query);
  const text = [
    memory.type,
    memory.title,
    memory.body,
    memory.rationale,
    memory.next_time,
    ...(memory.tags || []),
    ...(memory.code_paths || [])
  ].join(" ");
  const memoryTokens = tokenize(text);
  const memorySet = new Set(memoryTokens);
  const overlap = queryTokens.filter((token) => memorySet.has(token)).length;
  const keywordScore = queryTokens.length === 0 ? 0 : overlap / queryTokens.length;
  const partialScore = queryTokens.reduce((sum, token) => {
    if (memoryTokens.some((candidate) => candidate.includes(token) || token.includes(candidate))) {
      return sum + 0.04;
    }
    return sum;
  }, 0);

  const codePathScore = (memory.code_paths || []).some((codePath) => query.includes(codePath) || query.includes(path.basename(codePath)))
    ? 0.25
    : 0;
  const repoSpecificScore = (memory.code_paths || []).length > 0 ? 0.1 : 0;
  const ageDays = Math.max(0, (now - new Date(memory.updated_at || memory.created_at || now)) / 86400000);
  const recencyScore = 0.2 / (1 + ageDays / 30);
  const confidenceScore = Math.min(0.15, Number(memory.confidence || 0) * 0.15);
  const usefulnessScore = Math.min(0.25, Number(memory.usefulness || 0) * 0.2 + Math.log1p(Number(memory.used_count || 0)) * 0.03);
  const decayPenalty = Math.min(0.25, ageDays / 365 * 0.1);
  const typeBoost = TYPE_BOOSTS[memory.type] || 1;

  const score = Math.max(0, (keywordScore + partialScore + codePathScore + repoSpecificScore + recencyScore + confidenceScore + usefulnessScore - decayPenalty) * typeBoost);
  return {
    score,
    reasons: explainScore({ overlap, codePathScore, repoSpecificScore, recencyScore, confidenceScore, usefulnessScore, decayPenalty })
  };
}

function explainScore(parts) {
  const reasons = [];
  if (parts.overlap > 0) reasons.push(`${parts.overlap} matching term${parts.overlap === 1 ? "" : "s"}`);
  if (parts.codePathScore > 0) reasons.push("matches a linked code path");
  if (parts.repoSpecificScore > 0) reasons.push("has repo-specific code links");
  if (parts.recencyScore > 0.05) reasons.push("recent enough to prioritize");
  if (parts.confidenceScore > 0.1) reasons.push("high confidence");
  if (parts.usefulnessScore > 0.1) reasons.push("useful in prior sessions");
  if (parts.decayPenalty > 0.05) reasons.push("aged memory was slightly decayed");
  return reasons;
}

export function searchMemories(query, { root = process.cwd(), limit = 5 } = {}) {
  return listMemories(root)
    .map((memory) => {
      const scored = scoreMemory(memory, query);
      return { memory, score: scored.score, reasons: scored.reasons };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || String(b.memory.updated_at).localeCompare(String(a.memory.updated_at)))
    .slice(0, limit);
}

export function markMemoriesUsed(results, { root = process.cwd() } = {}) {
  const at = nowIso();
  return results.map(({ memory }) => updateMemory({
    ...memory,
    used_count: Number(memory.used_count || 0) + 1,
    last_used_at: at,
    usefulness: Math.min(1, Number(memory.usefulness || memory.confidence || 0.5) + 0.03),
    updated_at: at
  }, root));
}

export function formatInjection(results, { maxItems = 5 } = {}) {
  const selected = results.slice(0, maxItems);
  if (selected.length === 0) {
    return "No relevant CodeMem entries found.";
  }

  const lines = ["# Relevant CodeMem", ""];
  for (const { memory, score, reasons } of selected) {
    lines.push(`## ${memory.title}`);
    lines.push(`- Type: ${memory.type}`);
    lines.push(`- Score: ${score.toFixed(3)}`);
    lines.push(`- Why included: ${reasons.length ? reasons.join("; ") : "general relevance"}`);
    if (memory.code_paths?.length) {
      lines.push(`- Code: ${memory.code_paths.join(", ")}`);
    }
    lines.push("");
    lines.push(memory.body);
    if (memory.next_time) {
      lines.push("");
      lines.push(`Next time: ${memory.next_time}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
