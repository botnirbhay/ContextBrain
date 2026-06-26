# CodeMem

CodeMem is a local memory and learning layer for Codex and other coding agents.

It remembers durable project knowledge such as decisions, conventions, bug fixes, failed attempts, warnings, and lessons. On later tasks it retrieves the most relevant knowledge, builds a small context pack, launches your coding agent with that context, captures what happened, and proposes new learnings for review.

CodeMem is not a chat-history logger. It stores structured, human-editable memory that helps an agent behave like it has worked in the repository before.

## Quick Start

Use this flow inside the project where you want memory.

### 1. Install

For a packaged release:

```powershell
npm install -g codemem
```

For local development from this repository:

```powershell
cd C:\path\to\CodeMem
npm install
npm link
```

Check that the command is available:

```powershell
codemem --help
```

If you do not use global install or `npm link`, run the CLI directly:

```powershell
node C:\path\to\CodeMem\src\codemem.js --help
```

### 2. Set Up A Repo

Run setup once from the repository you want your coding agent to work in:

```powershell
cd C:\path\to\your-project
codemem setup
codemem verify
```

`codemem setup` creates:

```text
.codemem/
  AGENTS.md
  config.json
  memories/
  sessions/
  reflections/
    pending/
  indexes/
  bin/
    codemem.cmd
    codemem.ps1
    codemem
AGENTS.md
```

The root `AGENTS.md` is a bridge for agents that read repository instructions. If your repo already has a human-authored `AGENTS.md`, CodeMem leaves it untouched and writes `.codemem/AGENTS.bridge.md` for you to merge manually.

### 3. Configure Once

CodeMem works without API keys or cloud services. By default it launches Codex with:

```json
{
  "agentCommand": "codex exec",
  "resumeCommand": "codex resume --last",
  "autoReflect": true
}
```

To change the default agent command once per repo:

```powershell
codemem config --agent-command "codex exec --sandbox read-only"
codemem config --resume-command "codex resume --last --include-non-interactive"
```

Show current config:

```powershell
codemem config
```

### 4. Run Tasks

Start a new agent session with memory:

```powershell
codemem "implement oauth login"
```

Continue the previous Codex session with fresh CodeMem context:

```powershell
codemem resume "add tests for the oauth login"
```

Preview what CodeMem would do without launching the agent:

```powershell
codemem "inspect auth module" --dry-run
```

If `codemem` is not on PATH, use the repo-local wrapper created by setup:

```powershell
.\.codemem\bin\codemem.cmd "implement oauth login"
```

### 5. Review Learnings

After a task, CodeMem may propose durable memories. Review the latest pending file:

```powershell
codemem review
```

Approve only useful memories:

```powershell
codemem review --approve 1,3
```

Reject noisy memories:

```powershell
codemem review --reject 2
```

Approve or reject everything only when you have inspected the candidates:

```powershell
codemem review --approve-all
codemem review --reject-all
```

Regenerate distilled project instructions from approved memories:

```powershell
codemem learn
```

This updates:

```text
.codemem/AGENTS.md
```

## Daily Workflow

Most users only need these commands:

```powershell
codemem setup
codemem verify
codemem "new task"
codemem resume "follow-up task"
codemem review
codemem learn
codemem status
```

Use `codemem "new task"` when you want a fresh agent session.

Use `codemem resume "follow-up task"` when you want Codex conversation continuity. For Codex, CodeMem launches `codex resume --last` and passes a fresh memory-aware prompt into that resumed session.

## How It Works

When you run:

```powershell
codemem "your task"
```

CodeMem:

1. Starts a repo-local session.
2. Searches approved memories for the task.
3. Builds a small context pack.
4. Builds the final agent prompt.
5. Launches the configured agent command.
6. Captures changed files, git diff summary, command metadata, and outcome.
7. Reflects on the session.
8. Writes pending learnings for human review.

The default integration is a wrapper command instead of replacing `codex`. CodeMem does not shadow real agent CLIs because that can be surprising and hard to debug. The safe production entry point is:

```powershell
codemem "your task"
```

## Command Reference

### Setup And Health

```powershell
codemem setup
codemem verify
codemem doctor
codemem config
codemem uninstall
```

- `setup`: initializes `.codemem/`, config, wrappers, and AGENTS bridge.
- `verify`: runs diagnostics plus a dry-run workflow.
- `doctor`: checks Node, Git, default agent command, config, wrappers, and AGENTS files.
- `config`: shows or updates `.codemem/config.json`.
- `uninstall`: removes generated wrappers and generated root `AGENTS.md`; memory data remains.

### Agent Workflow

```powershell
codemem "task"
codemem run "task"
codemem agent "task"
codemem resume "follow-up task"
codemem continue
codemem status
```

- `codemem "task"`: shorthand for a new memory-aware agent run.
- `run` / `agent`: explicit form of the same workflow.
- `resume`: resumes the last Codex session using the configured resume command.
- `continue`: continues the last CodeMem session record without Codex resume semantics.
- `status`: shows the latest session, prompt, context pack, memories used, and files touched.

### Context And Prompt Preview

```powershell
codemem context "task"
codemem prompt "task"
codemem inject "task"
```

- `context`: shows the selected memories and why they were selected.
- `prompt`: shows the exact prompt CodeMem would send to the agent.
- `inject`: prints a compact memory block for another tool or agent.

### Memory Review

```powershell
codemem review
codemem review --approve 1,3
codemem review --reject 2
codemem review --approve-all
codemem review --reject-all
codemem learn
```

You can also review an explicit pending file:

```powershell
codemem review .codemem\reflections\pending\<pending-file>.json
```

### Manual Memory And Reflection

```powershell
codemem save --type decision --title "Use markdown records" --body "Store durable memories as markdown files with frontmatter."
codemem search "storage markdown frontmatter"
codemem list
codemem reflect --session .codemem\sessions\<session-file>.json
codemem reflect --task "task title" --file task-notes.md
```

Supported memory types:

```text
decision, convention, bug, fix, failed_attempt, lesson, todo, warning
```

### Manual Sessions

These are useful when another tool or agent drives the coding work:

```powershell
codemem session start --task "task title" --request "full request"
codemem session note "durable decision, failure, or lesson"
codemem session add-file src/example.js
codemem session command "npm test" --status passed
codemem session error "error or failed attempt"
codemem session status
codemem session stop --summary "what changed and why"
codemem session list
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

All files in `.codemem/` are local, human-readable, and Git-friendly.

## Memory Quality

Good memories are concrete:

- `Register CLI commands in src/cli.js because command routing is centralized there.`
- `Review defaults to the latest pending reflection to avoid file-path friction.`
- `Session stop records final outcome and commit metadata.`

Weak memories are filtered where possible:

- `Changed file: src/cli.js`
- `Validated session reflection`
- `Something happened during the session`

If two memories conflict, CodeMem surfaces the conflict during review instead of silently choosing one.

## Troubleshooting

Run:

```powershell
codemem doctor
```

Common warnings:

- `Default agent command available`: Codex is not installed or not on PATH. Dry-runs still work.
- `.codemem/bin on PATH`: optional. Global install or `npm link` is usually better than adding repo-local bins to PATH.
- `AGENTS.md bridge present`: setup did not create or could not replace a root `AGENTS.md`. Check `.codemem/AGENTS.bridge.md`.

Run:

```powershell
codemem verify
```

to confirm diagnostics plus the dry-run workflow.

## Current Limits

- Retrieval uses local keyword/token scoring, recency, confidence, usefulness, type boosts, and code-path boosts.
- Duplicate and conflict detection use local heuristics.
- Reflection extraction is heuristic and review-first.
- No vector database, cloud sync, team collaboration, or external embedding service.
- Optional AI providers can be added later, but the default path remains fully offline.

## Development

Run tests:

```powershell
npm test
```

Check package contents:

```powershell
npm pack --dry-run
```

If Windows blocks the npm cache, use a local cache:

```powershell
npm pack --dry-run --cache .tmp-npm-cache
```

The test suite covers storage, retrieval, context generation, prompt generation, session capture, reflection, review, duplicate/conflict detection, memory usefulness, AGENTS.md generation, setup, doctor, verify, config, uninstall, packaging, and no-key CLI behavior.
