# ContextBrain

ContextBrain is a local memory and learning layer for Codex CLI.

It helps Codex remember durable project knowledge across tasks: architecture decisions, conventions, bug fixes, failed attempts, warnings, and lessons. Before a task, ContextBrain builds a small context pack for Codex. After the task, it captures what happened and proposes new learnings for human review.

ContextBrain is not a chat-history logger. It stores structured, editable, repo-local memory so Codex can behave more like the same engineer returning to the same codebase.

## Install

Install from npm:

```powershell
npm install -g contextbrain
```

Check the command:

```powershell
cbr --help
```

Requirements:

- Node.js 20 or newer
- Git
- Codex CLI on PATH for real agent runs

ContextBrain itself does not require an OpenAI API key or any cloud service key. It uses local files and launches your already configured Codex CLI.

## First-Time Setup In A Project

Run this once inside the repository where Codex will work:

```powershell
cd C:\path\to\your-project
cbr setup
cbr verify
```

`cbr setup` creates:

```text
.contextbrain/
  AGENTS.md
  config.json
  memories/
  sessions/
  reflections/
    pending/
  indexes/
  bin/
    cbr.cmd
    cbr.ps1
    cbr
AGENTS.md
```

The root `AGENTS.md` is a bridge for Codex and other agent tools that read repository instructions. If your repo already has a human-authored `AGENTS.md`, ContextBrain leaves it untouched and writes `.contextbrain/AGENTS.bridge.md` so you can merge the snippet manually.

## Daily Codex Workflow

Most users only need this loop:

```powershell
cbr "implement oauth login"
cbr review
cbr learn
```

Use resume when you want Codex conversation continuity:

```powershell
cbr resume "add tests for oauth login"
```

Preview without launching Codex:

```powershell
cbr "inspect auth module" --dry-run
```

If `cbr` is not on PATH, use the repo-local wrapper created by setup:

```powershell
.\.contextbrain\bin\cbr.cmd "implement oauth login"
```

## What Happens When You Run `cbr "task"`

ContextBrain:

1. Starts a repo-local session.
2. Searches approved memories for the task.
3. Builds a compact Codex context pack.
4. Builds the final Codex prompt.
5. Launches `codex exec` by default.
6. Captures changed files, git diff summary, command metadata, and final outcome.
7. Reflects on the session.
8. Writes pending learnings for review.

The default config is stored in `.contextbrain/config.json`:

```json
{
  "agentCommand": "codex exec",
  "resumeCommand": "codex resume --last",
  "autoReflect": true
}
```

You can inspect it with:

```powershell
cbr config
```

For a safer read-only default, configure Codex once per repo:

```powershell
cbr config --agent-command "codex exec --sandbox read-only"
```

## Review And Learn

After a task, ContextBrain may create pending memory candidates. Review them before they become long-lived project knowledge:

```powershell
cbr review
```

Approve useful candidates:

```powershell
cbr review --approve 1,3
```

Reject noisy candidates:

```powershell
cbr review --reject 2
```

Approve or reject everything only after inspecting the list:

```powershell
cbr review --approve-all
cbr review --reject-all
```

Regenerate distilled project instructions from approved memories:

```powershell
cbr learn
```

This writes:

```text
.contextbrain/AGENTS.md
```

That file becomes the durable project brain Codex can read in future sessions.

## Useful Commands

### Setup And Health

```powershell
cbr setup
cbr verify
cbr doctor
cbr config
cbr uninstall
```

- `setup`: initializes `.contextbrain/`, config, wrappers, and the AGENTS bridge.
- `verify`: runs diagnostics plus a dry-run workflow.
- `doctor`: checks Node, Git, Codex, config, wrappers, and AGENTS files.
- `config`: shows or updates `.contextbrain/config.json`.
- `uninstall`: removes generated wrappers and generated root `AGENTS.md`; memory data remains.

### Codex Workflow

```powershell
cbr "task"
cbr run "task"
cbr agent "task"
cbr resume "follow-up task"
cbr continue
cbr status
```

- `cbr "task"`: shorthand for a new memory-aware Codex run.
- `run` / `agent`: explicit forms of the same workflow.
- `resume`: resumes the last Codex conversation using `codex resume --last` by default.
- `continue`: continues the last ContextBrain session record without Codex resume semantics.
- `status`: shows the latest session, prompt, context pack, memories used, and files touched.

### Context Preview

```powershell
cbr context "task"
cbr prompt "task"
cbr inject "task"
```

- `context`: shows selected memories and why they were selected.
- `prompt`: shows the exact prompt ContextBrain would send to Codex.
- `inject`: prints a compact memory block for manual use.

### Manual Memory And Reflection

```powershell
cbr save --type decision --title "Use markdown records" --body "Store durable memories as markdown files with frontmatter."
cbr search "storage markdown frontmatter"
cbr list
cbr reflect --session .contextbrain\sessions\<session-file>.json
cbr reflect --task "task title" --file task-notes.md
```

Supported memory types:

```text
decision, convention, bug, fix, failed_attempt, lesson, todo, warning
```

### Manual Sessions

Manual sessions are useful if Codex is not launched through `cbr`, but you still want structured capture:

```powershell
cbr session start --task "task title" --request "full request"
cbr session note "durable decision, failure, or lesson"
cbr session add-file src/example.js
cbr session command "npm test" --status passed
cbr session error "error or failed attempt"
cbr session status
cbr session stop --summary "what changed and why"
cbr session list
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

All files in `.contextbrain/` are local, human-readable, and Git-friendly.

## Memory Quality

Good memories are concrete:

- `Register CLI commands in src/cli.js because command routing is centralized there.`
- `Review defaults to the latest pending reflection to avoid file-path friction.`
- `Session stop records final outcome and commit metadata.`

Weak memories are filtered where possible:

- `Changed file: src/cli.js`
- `Validated session reflection`
- `Something happened during the session`

If two memories conflict, ContextBrain surfaces the conflict during review instead of silently choosing one.

## Codex-First Scope

ContextBrain v1 is intentionally Codex-first. The default commands are `codex exec` and `codex resume --last`, and the README focuses on that workflow.

Advanced users can still point ContextBrain at another command with `cbr config --agent-command "..."`, but first-class support and documentation for other agents is intentionally out of scope for this release.

## Troubleshooting

Run:

```powershell
cbr doctor
```

Common warnings:

- `Default agent command available`: Codex is not installed or not on PATH. Dry-runs still work.
- `.contextbrain/bin on PATH`: optional. Global npm install is usually better than adding repo-local bins to PATH.
- `AGENTS.md bridge present`: setup did not create or could not replace a root `AGENTS.md`. Check `.contextbrain/AGENTS.bridge.md`.

Run:

```powershell
cbr verify
```

to confirm diagnostics plus the dry-run workflow.

## Current Limits

- Retrieval uses local keyword/token scoring, recency, confidence, usefulness, type boosts, and code-path boosts.
- Duplicate and conflict detection use local heuristics.
- Reflection extraction is heuristic and review-first.
- No vector database, cloud sync, team collaboration, or external embedding service.
- Codex is the supported default agent for v1.

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