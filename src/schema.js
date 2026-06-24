export const MEMORY_TYPES = [
  "decision",
  "convention",
  "bug",
  "fix",
  "failed_attempt",
  "lesson",
  "todo",
  "warning"
];

export function assertMemoryType(type) {
  if (!MEMORY_TYPES.includes(type)) {
    throw new Error(`Invalid memory type "${type}". Expected one of: ${MEMORY_TYPES.join(", ")}`);
  }
}

export function nowIso() {
  return new Date().toISOString();
}

export function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "memory";
}

export function makeId(type, title, createdAt = nowIso()) {
  const stamp = createdAt.replace(/[-:TZ.]/g, "").slice(0, 14);
  return `${stamp}-${type}-${slugify(title)}`;
}
