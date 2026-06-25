# CodeMem

CodeMem is a local memory and learning layer for Codex and other coding agents. It stores structured project knowledge such as decisions, conventions, bug fixes, failed attempts, warnings, and lessons, then injects the most relevant knowledge into future coding sessions.

CodeMem is not a chat-history logger. It keeps durable, human-reviewable memories that help an agent behave like it has worked in the repository before.

## What A First-Time User Does

Use this flow in the real project where Codex should have memory.

### 1. Install CodeMem

From the CodeMem repository:

```powershell
npm install
npm link
```

Verify the commands are available:

```powershell
codemem --help
```

If you do not want to use `npm link`, replace `codemem` in the examples with:

```powershell
node C:\path\to\CodeMem\src\cli.js
```

### 2. Set Up One Project

Go to the project you want Codex to work on:

```powershell
cd C:\path\to\your-project
codemem setup
codemem doctor
```

`setup` creates local files in that project:

```text
.codemem/
  AGENTS.md
  bin/
    codemem.cmd
    codemem.ps1
    codemem
  memories/
  sessions/
  reflections/
    pending/
  indexes/
```

It also creates a root `AGENTS.md` bridge if one does not already exist. If your project already has a human-authored `AGENTS.md`, CodeMem leaves it untouched and writes `.codemem/AGENTS.bridge.md` for you to merge manually.

### 3. Run A Safe Dry Run

`<your task>` is a placeholder. Replace it with the actual thing you want Codex to do.

PowerShell:

```powershell
codemem "<your task>" --dry-run
```

Example with a real task:

```powershell
codemem "inspect the authentication module and report likely cleanup tasks" --dry-run
```

Dry-run does not launch the configured agent. It only creates the prompt, context pack, session record, and reflection scaffold so you can verify the setup.

### 4. Run An Agent With Memory

After the dry run looks good and your coding-agent CLI is installed. Codex is the default command today:

```powershell
codemem "<your task>"
```

Use this when you want a fresh agent session for a new task.

To continue the most recent Codex session instead:

```powershell
codemem resume "<follow-up task>"
```

For Codex, this launches `codex resume --last` with a fresh CodeMem prompt. That keeps the Codex conversation continuity while still refreshing project memory and context.

If you did not run `npm link`, use the repo-local wrapper:

```powershell
.codemem\bin\codemem.cmd "<your task>"
```

The setup command also prints optional PATH commands for `.codemem/bin`, but the recommended developer install is `npm link` so `codemem` is available everywhere.

### 5. Review Learnings

After a task, inspect pending learnings:

```powershell
Get-ChildItem .codemem\reflections\pending
```

Review a pending file. Replace `<pending-file>` with the real file name from the previous command:

```powershell
codemem review .codemem\reflections\pending\<pending-file>.json
```

Approve only the useful candidates:

```powershell
codemem review .codemem\reflections\pending\<pending-file>.json --approve 1,3
```

Or approve all only when every candidate is good:

```powershell
codemem review .codemem\reflections\pending\<pending-file>.json --approve-all
```

Regenerate distilled project rules:

```powershell
codemem learn
```

That updates:

```text
.codemem/AGENTS.md
```

## How Coding-Agent Integration Works

CodeMem integrates with coding agents in two safe ways.

### Wrapper Integration

The wrapper is the main integration:

```powershell
codemem "<your task>"
```

The wrapper does the full lifecycle:

1. Starts a codemem session.
2. Retrieves relevant memories.
3. Builds a small context pack.
4. Builds the final agent prompt.
5. Launches the real default agent command with that enriched prompt.
6. Captures changed files, git diff summary, command metadata, and outcome.
7. Reflects on the session.
8. Writes pending learnings for review.

Equivalent explicit command:

```powershell
codemem agent "<your task>"
```

### AGENTS.md Bridge

`setup` creates a root `AGENTS.md` bridge so an agent opened directly in the repo can see that the repository uses CodeMem. It tells Codex to consult `.codemem/AGENTS.md` and use task-specific memory when available.

This helps, but it cannot fully automate the lifecycle by itself. If you run the real Codex command directly:

```powershell
codex "<your task>"
```

CodeMem does not automatically get a pre-run or post-run hook unless Codex itself provides one. That is why the wrapper command exists.

## Why CodeMem Does Not Replace Agent Commands By Default

CodeMem does not install fake agent commands by default because shadowing real CLIs can be surprising and hard to debug. A direct shim must avoid recursion, preserve the real agent path, and uninstall cleanly.

The safe production default is:

```powershell
codemem "<your task>"
```

This gives a short command without hiding the real `codex` binary.

## Common Commands

Preview the exact prompt CodeMem would send to the configured coding agent:

```powershell
codemem prompt "<your task>"
```

Preview the memory context only:

```powershell
codemem context "<your task>"
```

Run the workflow without launching the configured agent:

```powershell
codemem agent "<your task>" --dry-run
```

Run the real workflow:

```powershell
codemem "<your task>"
```

Resume the previous Codex session with fresh memory context:

```powershell
codemem resume "<follow-up task>"
```

Check current state:

```powershell
codemem status
```

Run diagnostics:

```powershell
codemem doctor
```

Remove generated setup files:

```powershell
codemem uninstall
```

`uninstall` removes only CodeMem-generated wrappers and a CodeMem-generated root `AGENTS.md`. It leaves memories, sessions, reflections, and human-authored files alone.

## Manual Memory Commands

Save a memory manually:

```powershell
codemem save --type decision --title "Use markdown records" --body "Store durable memories as markdown files with frontmatter." --rationale "Humans can review and edit records in normal Git workflows." --next-time "Prefer markdown records for storage changes." --code src/storage.js --tag storage
```

Search memories:

```powershell
codemem search "storage markdown frontmatter" --limit 5
```

Inject relevant memory for another agent:

```powershell
codemem inject "<your task>" --limit 3
```

## Manual Session Commands

These are useful when another tool or agent is driving the coding work:

```powershell
codemem session start --task "<task title>" --request "<full request>"
codemem session note "<durable decision, failure, or lesson>"
codemem session add-file src/example.js
codemem session command "npm test" --status passed
codemem session error "<error or failed attempt>"
codemem session stop --summary "<what changed and why>" --commit abc123
```

Reflect from a saved session:

```powershell
codemem reflect --session .codemem\sessions\<session-file>.json
```

Reflect from notes:

```powershell
codemem reflect --task "<task title>" --file task-notes.md
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

`codemem doctor` checks:

- Node.js version
- Git availability
- default agent command availability
- `.codemem/` initialization
- `codemem` wrapper installation
- AGENTS bridge presence
- whether `.codemem/bin` is on PATH

Warnings do not always block usage. CodeMem works without the default agent installed when using `--dry-run`, and it works without Git metadata outside a Git repository.

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




