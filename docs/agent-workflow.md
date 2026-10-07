# Agent Workflow

CogGit is useful when an agent needs local design context while changing code.

The practical loop is simple:

1. Orient with `snapshot` (or the mirror convention) to locate the relevant cognition document.
2. Read the paired cognition before broad source inspection.
3. Check freshness and evidence before deciding whether the cognition needs an update.
4. Keep the cognition aligned when the code changes.

The mirror convention needs no tool call: a file's cognition document is its
source-relative path with a trailing `.md`; a folder's is its `README.md`.

## Suggested Instruction

Give your agent host the CogGit guidance with `coggit instructions` — it prints the maintained form, so the wording lives in one place:

```console
# per-invocation (e.g. Claude Code)
claude --append-system-prompt "$(coggit instructions --kind standard)"

# persistent, for hosts that read AGENTS.md (Codex, Claude Code, Gemini CLI, ...)
coggit instructions --kind standard --format block >> AGENTS.md
```

dsh and MCP hosts do not need this — they inject the guidance through their
own adapter surfaces.

## Why This Matters

This workflow reduces agent drift. Instead of reconstructing local constraints from scattered evidence on every task, the agent starts from maintained cognition that already reflects the current implementation boundary.
