import { markMemoriesUsed, searchMemories } from "./retrieval.js";

const GROUPS = [
  { title: "Relevant Project Memory", types: ["lesson", "warning", "todo"] },
  { title: "Relevant Decisions", types: ["decision", "convention"] },
  { title: "Relevant Bugs", types: ["bug", "fix"] },
  { title: "Relevant Failed Attempts", types: ["failed_attempt"] }
];

export function buildContextPack(task, { root = process.cwd(), limit = 8, markUsed = false } = {}) {
  const results = searchMemories(task, { root, limit: Math.max(limit, 12) });
  const selected = [];
  const used = new Set();

  for (const group of GROUPS) {
    const matches = results.filter((result) => group.types.includes(result.memory.type) && !used.has(result.memory.id)).slice(0, 3);
    for (const match of matches) {
      selected.push({ ...match, group: group.title });
      used.add(match.memory.id);
      if (selected.length >= limit) break;
    }
    if (selected.length >= limit) break;
  }

  for (const result of results) {
    if (selected.length >= limit) break;
    if (!used.has(result.memory.id)) {
      selected.push({ ...result, group: "Relevant Project Memory" });
      used.add(result.memory.id);
    }
  }

  if (markUsed && selected.length > 0) {
    markMemoriesUsed(selected, { root });
  }

  return {
    task,
    generated_at: new Date().toISOString(),
    memories_used: selected.map((result) => result.memory.id),
    groups: GROUPS.map((group) => ({
      title: group.title,
      memories: selected.filter((result) => result.group === group.title)
    })).filter((group) => group.memories.length > 0)
  };
}

export function formatContextPack(pack, { includeTask = true } = {}) {
  const lines = includeTask ? [`Task: ${pack.task}`, ""] : [];
  if (pack.groups.length === 0) {
    lines.push("No relevant CodeMem entries found.");
    return lines.join("\n");
  }

  for (const group of pack.groups) {
    lines.push(`${group.title}:`);
    for (const result of group.memories) {
      const memory = result.memory;
      lines.push(`- ${memory.title}`);
      lines.push(`  Type: ${memory.type}`);
      lines.push(`  Why selected: ${result.reasons.join("; ") || "general relevance"}`);
      if (memory.code_paths?.length) lines.push(`  Files: ${memory.code_paths.join(", ")}`);
      lines.push(`  Guidance: ${memory.next_time || memory.body}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export function buildCodexPrompt(task, { root = process.cwd(), markUsed = false } = {}) {
  const pack = buildContextPack(task, { root, markUsed });
  return {
    pack,
    prompt: [
      `Task: ${task}`,
      "",
      formatContextPack(pack, { includeTask: false }),
      "",
      "Use the relevant project memory above as guidance. Prefer current repository code over memory if they conflict, and surface any conflict before deciding.",
      "After completing the work, summarize durable decisions, failed attempts, bug fixes, changed files, commands run, and final outcome so CodeMem can reflect on them."
    ].join("\n")
  };
}
