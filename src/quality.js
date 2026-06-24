import { listMemories } from "./storage.js";
import { tokenize } from "./retrieval.js";

const OPPOSING_TERMS = [
  ["use", "remove"],
  ["use", "avoid"],
  ["prefer", "avoid"],
  ["enable", "disable"],
  ["keep", "remove"],
  ["add", "remove"]
];

export function findDuplicateMemories(candidate, memories) {
  const candidateText = normalize(`${candidate.title} ${candidate.body}`);
  return memories.filter((memory) => {
    if (memory.id === candidate.id) return false;
    const memoryText = normalize(`${memory.title} ${memory.body}`);
    const similarity = jaccard(tokenize(candidateText), tokenize(memoryText));
    return memoryText === candidateText || similarity >= 0.55 || oneContainsMostOfTheOther(tokenize(candidateText), tokenize(memoryText));
  });
}

function oneContainsMostOfTheOther(a, b) {
  const left = new Set(a);
  const right = new Set(b);
  const smaller = left.size <= right.size ? left : right;
  const larger = left.size <= right.size ? right : left;
  const covered = [...smaller].filter((item) => larger.has(item)).length;
  return smaller.size > 0 && covered / smaller.size >= 0.72;
}

export function findMemoryConflicts(candidate, memories) {
  if (!["decision", "convention", "warning"].includes(candidate.type)) return [];
  const candidateTokens = tokenize(`${candidate.title} ${candidate.body}`);
  return memories.filter((memory) => {
    if (memory.id === candidate.id || memory.type !== candidate.type) return false;
    const memoryTokens = tokenize(`${memory.title} ${memory.body}`);
    const overlap = jaccard(candidateTokens, memoryTokens);
    const opposing = OPPOSING_TERMS.some(([a, b]) =>
      (candidateTokens.includes(a) && memoryTokens.includes(b)) ||
      (candidateTokens.includes(b) && memoryTokens.includes(a))
    );
    const shared = candidateTokens.filter((token) => memoryTokens.includes(token) && !["decision", "decided", "because", "for", "the", "use"].includes(token));
    return opposing && (overlap >= 0.28 || shared.length > 0);
  });
}

export function analyzeCandidate(candidate, root = process.cwd()) {
  const memories = listMemories(root);
  return {
    duplicates: findDuplicateMemories(candidate, memories),
    conflicts: findMemoryConflicts(candidate, memories)
  };
}

function normalize(text) {
  return String(text).toLowerCase().replace(/\s+/g, " ").trim();
}

function jaccard(a, b) {
  const left = new Set(a);
  const right = new Set(b);
  const intersection = [...left].filter((item) => right.has(item)).length;
  const union = new Set([...left, ...right]).size || 1;
  return intersection / union;
}
