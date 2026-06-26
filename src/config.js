import fs from "node:fs";
import path from "node:path";
import { initStore, paths, readJson, writeJson } from "./storage.js";

export const DEFAULT_CONFIG = {
  agentCommand: "codex exec",
  resumeCommand: "codex resume --last",
  autoReflect: true
};

export function configPath(root = process.cwd()) {
  return path.join(paths(root).base, "config.json");
}

export function ensureConfig(root = process.cwd()) {
  const p = initStore(root);
  const filePath = path.join(p.base, "config.json");
  if (!fs.existsSync(filePath)) {
    writeJson(filePath, DEFAULT_CONFIG);
  }
  return filePath;
}

export function readConfig(root = process.cwd()) {
  const filePath = ensureConfig(root);
  const loaded = readJson(filePath);
  return normalizeConfig(loaded);
}

export function writeConfig(updates, root = process.cwd()) {
  const current = readConfig(root);
  const next = normalizeConfig({ ...current, ...updates });
  writeJson(configPath(root), next);
  return next;
}

export function formatConfig(config) {
  return [
    `agentCommand: ${config.agentCommand}`,
    `resumeCommand: ${config.resumeCommand}`,
    `autoReflect: ${config.autoReflect}`
  ].join("\n");
}

function normalizeConfig(input) {
  const config = { ...DEFAULT_CONFIG, ...(input || {}) };
  return {
    agentCommand: nonEmptyString(config.agentCommand, DEFAULT_CONFIG.agentCommand),
    resumeCommand: nonEmptyString(config.resumeCommand, DEFAULT_CONFIG.resumeCommand),
    autoReflect: Boolean(config.autoReflect)
  };
}

function nonEmptyString(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
