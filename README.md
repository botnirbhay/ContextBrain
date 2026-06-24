# CodexMemory

CodexMemory is a local memory and learning layer for Codex and other coding agents. It stores structured project knowledge such as decisions, conventions, bug fixes, failed attempts, warnings, and lessons, then injects the most relevant knowledge into future coding sessions.

CodexMemory is not a chat-history logger. It keeps durable, human-reviewable memories that help an agent behave like it has worked in the repository before.

## What A First-Time User Does

Use this flow in the real project where Codex should have memory.

### 1. Install CodexMemory

From the CodexMemory repository:

```powershell
npm install
npm link
```

Verify the commands are available:

```powershell
codexmemory --help
codexm --help
```

If you do not want to use `npm link`, replace `codexmemory` in the examples with:

```powershell
node C:\path\to\CodexMemory\src\cli.js
```

### 2. Set Up One Project

Go to the project you want Codex to work on:

```powershell
cd C:\path\to\your-project
codexmemory setup
codexmemory doctor
```

`setup` creates local files in that project:

```text
.codexmemory/
  AGENTS.md
  bin/
    codexm.cmd
    codexm.ps1
    codexm
  memories/
  sessions/
  reflections/
    pending/
  indexes/
```

It also creates a root `AGENTS.md` bridge if one does not already exist. If your project already has a human-authored `AGENTS.md`, CodexMemory leaves it untouched and writes `.codexmemory/AGENTS.bridge.md` for you to merge manually.

### 3. Run A Safe Dry Run

`<your task>` is a placeholder. Replace it with the actual thing you want Codex to do.

PowerShell:

```powershell
.codexmemory\bin\codexm.cmd "<your task>" --dry-run
```

Example with a real task:

```powershell
.codexmemory\bin\codexm.cmd "inspect the authentication module and report likely cleanup tasks" --dry-run
```

Dry-run does not launch Codex. It only creates the prompt, context pack, session record, and reflection scaffold so you can verify the setup.

### 4. Run Codex With Memory

After the dry run looks good and Codex CLI is installed:

```powershell
.codexmemory\bin\codexm.cmd "<your task>"
```

If you add `.codexmemory\bin` to PATH, you can use the shorter command:

```powershell
codexm "<your task>"
```

The setup command prints the exact PATH commands for your shell.

### 5. Review Learnings

After a task, inspect pending learnings:

```powershell
Get-ChildItem .codexmemory\reflections\pending
```

Review a pending file. Replace `<pending-file>` with the real file name from the previous command:

```powershell
codexmemory review .codexmemory\reflections\pending\<pending-file>.json
```

Approve only the useful candidates:

```powershell
codexmemory review .codexmemory\reflections\pending\<pending-file>.json --approve 1,3
```

Or approve all only when every candidate is good:

```powershell
codexmemory review .codexmemory\reflections\pending\<pending-file>.json --approve-all
```

Regenerate distilled project rules:

```powershell
codexmemory learn
```

That updates:

```text
.codexmemory/AGENTS.md
```

## How Codex Integration Works

CodexMemory integrates with Codex in two safe ways.

### Wrapper Integration

The wrapper is the main integration:

```powershell
.codexmemory\bin\codexm.cmd "<your task>"
```

or, after PATH setup:

```powershell
codexm "<your task>"
```

The wrapper does the full lifecycle:

1. Starts a CodexMemory session.
2. Retrieves relevant memories.
3. Builds a small context pack.
4. Builds the final Codex prompt.
5. Launches the real Codex CLI with that enriched prompt.
6. Captures changed files, git diff summary, command metadata, and outcome.
7. Reflects on the session.
8. Writes pending learnings for review.

Equivalent explicit command:

```powershell
codexmemory codex "<your task>"
```

### AGENTS.md Bridge

`setup` creates a root `AGENTS.md` bridge so Codex opened directly in the repo can see that the repository uses CodexMemory. It tells Codex to consult `.codexmemory/AGENTS.md` and use task-specific memory when available.

This helps, but it cannot fully automate the lifecycle by itself. If you run the real Codex command directly:

```powershell
codex "<your task>"
```

CodexMemory does not automatically get a pre-run or post-run hook unless Codex itself provides one. That is why the wrapper command exists.

## Why CodexMemory Does Not Replace `codex` By Default

CodexMemory does not install a fake `codex` command by default because shadowing a real CLI can be surprising and hard to debug. A direct `codex` shim must avoid recursion, preserve the real Codex path, and uninstall cleanly.

The safe production default is:

```powershell
codexm "<your task>"
```

This gives a short command without hiding the real `codex` binary.

## Common Commands

Preview the exact prompt CodexMemory would send to Codex:

```powershell
codexmemory prompt "<your task>"
```

Preview the memory context only:

```powershell
codexmemory context "<your task>"
```

Run the workflow without launching Codex:

```powershell
codexmemory codex "<your task>" --dry-run
```

Run the real workflow:

```powershell
codexm "<your task>"
```

Check current state:

```powershell
codexmemory status
```

Run diagnostics:

```powershell
codexmemory doctor
```

Remove generated setup files:

```powershell
codexmemory uninstall
```

`uninstall` removes only CodexMemory-generated wrappers and a CodexMemory-generated root `AGENTS.md`. It leaves memories, sessions, reflections, and human-authored files alone.

## Manual Memory Commands

Save a memory manually:

```powershell
codexmemory save --type decision --title "Use markdown records" --body "Store durable memories as markdown files with frontmatter." --rationale "Humans can review and edit records in normal Git workflows." --next-time "Prefer markdown records for storage changes." --code src/storage.js --tag storage
```

Search memories:

```powershell
codexmemory search "storage markdown frontmatter" --limit 5
```

Inject relevant memory for another agent:

```powershell
codexmemory inject "<your task>" --limit 3
```

## Manual Session Commands

These are useful when another tool or agent is driving the coding work:

```powershell
codexmemory session start --task "<task title>" --request "<full request>"
codexmemory session note "<durable decision, failure, or lesson>"
codexmemory session add-file src/example.js
codexmemory session command "npm test" --status passed
codexmemory session error "<error or failed attempt>"
codexmemory session stop --summary "<what changed and why>" --commit abc123
```

Reflect from a saved session:

```powershell
codexmemory reflect --session .codexmemory\sessions\<session-file>.json
```

Reflect from notes:

```powershell
codexmemory reflect --task "<task title>" --file task-notes.md
```

## Memory Format

Approved memories are Markdown files with JSON-compatible frontmatter:

```markdown
---
id: "20260622170000-decision-use-markdown-records"
type: "decision"
title: "Use markdown records"
created_at: "2026-06-22T17:00:00.000Z"
updated_at: "2026-06-22T17:00:00.000Z"
confidence: 0.7
used_count: 0
last_used_at: ""
usefulness: 0.7
tags: ["storage"]
code_paths: ["src/storage.js"]
source: "manual"
---

# Use markdown records

Store durable memories as markdown files with frontmatter.

## Why It Matters

Humans can review and edit records in normal Git workflows.

## Next Time

Prefer markdown records for storage changes.
```

Supported memory types:

```text
decision, convention, bug, fix, failed_attempt, lesson, todo, warning
```

## Reflection Quality

Good memories are concrete:

- `Register CLI commands in src/cli.js because command routing is centralized there.`
- `Review requires a pending reflection file path.`
- `Session stop records final outcome and commit metadata.`

Weak memories are filtered where possible:

- `Changed file: src/cli.js`
- `Validated session reflection`
- `Something happened during the session`

## Doctor And Troubleshooting

`codexmemory doctor` checks:

- Node.js version
- Git availability
- Codex CLI availability
- `.codexmemory/` initialization
- `codexm` wrapper installation
- AGENTS bridge presence
- whether `.codexmemory/bin` is on PATH

Warnings do not always block usage. CodexMemory works without Codex installed when using `--dry-run`, and it works without Git metadata outside a Git repository.

## Current Limits

- Retrieval uses local keyword/token scoring, recency, confidence, usefulness, type boosts, and code-path boosts.
- Duplicate and conflict detection use local heuristics.
- Reflection extraction is heuristic and review-first.
- No vector database, cloud sync, team collaboration, or external embedding service.
- Optional AI providers can be added later, but the default path must remain fully offline.

## Development

Run tests:

```powershell
npm test
```

The test suite covers storage, retrieval, context generation, prompt generation, session capture, reflection, review, duplicate/conflict detection, memory usefulness, AGENTS.md generation, setup, doctor, uninstall, and no-key CLI behavior.
