#!/usr/bin/env node
process.argv.splice(2, 0, "codex");
await import("./cli.js");
