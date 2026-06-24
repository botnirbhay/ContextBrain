import fs from "node:fs";
import path from "node:path";
import { assertMemoryType, makeId, nowIso } from "./schema.js";

export const MEMORY_DIR = ".codexmemory";

export function resolveRoot(root = process.cwd()) {
  return path.resolve(root);
}

export function paths(root = process.cwd()) {
  const base = path.join(resolveRoot(root), MEMORY_DIR);
  return {
    base,
    memories: path.join(base, "memories"),
    sessions: path.join(base, "sessions"),
    reflections: path.join(base, "reflections"),
    indexes: path.join(base, "indexes"),
    pending: path.join(base, "reflections", "pending"),
    bin: path.join(base, "bin")
  };
}

export function initStore(root = process.cwd()) {
  const p = paths(root);
  for (const dir of [p.base, p.memories, p.sessions, p.reflections, p.indexes, p.pending]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const readmePath = path.join(p.base, "README.md");
  if (!fs.existsSync(readmePath)) {
    fs.writeFileSync(
      readmePath,
      [
        "# CodexMemory Store",
        "",
        "This folder contains durable, human-editable project memories.",
        "",
        "- `memories/`: approved long-lived memory records.",
        "- `reflections/`: task reflections and pending memory proposals.",
        "- `sessions/`: optional session notes.",
        "- `indexes/`: generated indexes; safe to rebuild.",
        ""
      ].join("\n")
    );
  }

  return p;
}

export function encodeFrontmatter(data) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map((item) => JSON.stringify(item)).join(", ")}]`);
    } else {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

export function decodeFrontmatter(text) {
  if (!text.startsWith("---\n")) {
    return [{}, text];
  }
  const end = text.indexOf("\n---", 4);
  if (end === -1) {
    return [{}, text];
  }

  const raw = text.slice(4, end).trim();
  const body = text.slice(end + 5).replace(/^\r?\n/, "");
  const data = {};
  for (const line of raw.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    data[key] = parseScalar(value);
  }
  return [data, body];
}

function parseScalar(value) {
  if (value.startsWith("[") && value.endsWith("]")) {
    try {
      return JSON.parse(value);
    } catch {
      return [];
    }
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function memoryToMarkdown(memory) {
  const metadata = {
    id: memory.id,
    type: memory.type,
    title: memory.title,
    created_at: memory.created_at,
    updated_at: memory.updated_at,
    confidence: memory.confidence,
    used_count: memory.used_count || 0,
    last_used_at: memory.last_used_at || "",
    usefulness: memory.usefulness ?? Number(memory.confidence || 0),
    tags: memory.tags || [],
    code_paths: memory.code_paths || [],
    source: memory.source || "manual"
  };

  return [
    encodeFrontmatter(metadata),
    "",
    `# ${memory.title}`,
    "",
    memory.body.trim(),
    "",
    "## Why It Matters",
    "",
    (memory.rationale || "No rationale provided.").trim(),
    "",
    "## Next Time",
    "",
    (memory.next_time || "Use this memory when the task touches related code or decisions.").trim(),
    ""
  ].join("\n");
}

export function markdownToMemory(filePath, text) {
  const [metadata, body] = decodeFrontmatter(text);
  const titleMatch = body.match(/^#\s+(.+)$/m);
  const whyIdx = body.indexOf("\n## Why It Matters");
  const nextIdx = body.indexOf("\n## Next Time");
  const mainBody = whyIdx === -1 ? body : body.slice(0, whyIdx);
  const rationale = whyIdx === -1 ? "" : body.slice(whyIdx, nextIdx === -1 ? undefined : nextIdx).replace(/\n## Why It Matters\s*/, "").trim();
  const nextTime = nextIdx === -1 ? "" : body.slice(nextIdx).replace(/\n## Next Time\s*/, "").trim();

  return {
    id: metadata.id || path.basename(filePath, ".md"),
    type: metadata.type,
    title: metadata.title || titleMatch?.[1] || path.basename(filePath, ".md"),
    created_at: metadata.created_at,
    updated_at: metadata.updated_at,
    confidence: Number(metadata.confidence || 0),
    used_count: Number(metadata.used_count || 0),
    last_used_at: metadata.last_used_at || "",
    usefulness: Number(metadata.usefulness ?? metadata.confidence ?? 0),
    tags: Array.isArray(metadata.tags) ? metadata.tags : [],
    code_paths: Array.isArray(metadata.code_paths) ? metadata.code_paths : [],
    source: metadata.source || "manual",
    body: mainBody.replace(/^#\s+.+$/m, "").trim(),
    rationale,
    next_time: nextTime,
    file_path: filePath
  };
}

export function saveMemory(input, root = process.cwd()) {
  const p = initStore(root);
  assertMemoryType(input.type);
  const createdAt = input.created_at || nowIso();
  const memory = {
    id: input.id || makeId(input.type, input.title, createdAt),
    type: input.type,
    title: input.title,
    created_at: createdAt,
    updated_at: input.updated_at || createdAt,
    confidence: Number(input.confidence ?? 0.7),
    used_count: Number(input.used_count || 0),
    last_used_at: input.last_used_at || "",
    usefulness: Number(input.usefulness ?? input.confidence ?? 0.7),
    tags: input.tags || [],
    code_paths: input.code_paths || [],
    source: input.source || "manual",
    body: input.body,
    rationale: input.rationale || "",
    next_time: input.next_time || ""
  };

  const filePath = path.join(p.memories, `${memory.id}.md`);
  if (fs.existsSync(filePath)) {
    throw new Error(`Memory already exists: ${filePath}`);
  }
  fs.writeFileSync(filePath, memoryToMarkdown(memory));
  return { ...memory, file_path: filePath };
}

export function updateMemory(memory, root = process.cwd()) {
  const p = initStore(root);
  if (!memory.id) {
    throw new Error("Cannot update memory without an id.");
  }
  const filePath = memory.file_path || path.join(p.memories, `${memory.id}.md`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Memory not found: ${filePath}`);
  }
  const updated = {
    ...memory,
    updated_at: memory.updated_at || nowIso()
  };
  fs.writeFileSync(filePath, memoryToMarkdown(updated));
  return { ...updated, file_path: filePath };
}

export function listMemories(root = process.cwd()) {
  const p = paths(root);
  if (!fs.existsSync(p.memories)) {
    return [];
  }
  return fs.readdirSync(p.memories)
    .filter((file) => file.endsWith(".md"))
    .sort()
    .map((file) => {
      const filePath = path.join(p.memories, file);
      return markdownToMemory(filePath, fs.readFileSync(filePath, "utf8"));
    });
}

export function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
