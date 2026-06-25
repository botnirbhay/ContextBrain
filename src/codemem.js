#!/usr/bin/env node
const subcommands = new Set([
  "agent",
  "context",
  "continue",
  "doctor",
  "help",
  "init",
  "inject",
  "learn",
  "list",
  "prompt",
  "reflect",
  "review",
  "resume",
  "run",
  "save",
  "search",
  "session",
  "setup",
  "status",
  "uninstall",
  "--help"
]);

if (!subcommands.has(process.argv[2])) {
  process.argv.splice(2, 0, "agent");
}

await import("./cli.js");
