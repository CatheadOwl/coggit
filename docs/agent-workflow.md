---
description: The CogGit agent working loop — orient via snapshot or the mirror convention, read the paired cognition first, keep pairs fresh
---

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

Give your agent host the CogGit guidance with `coggit entry` — it prints the maintained form, so the wording lives in one place:

```console
# per-invocation (e.g. Claude Code)
claude --append-system-prompt "$(coggit entry --kind standard)"

# persistent, for hosts that read AGENTS.md (Codex, Claude Code, Gemini CLI, ...)
coggit entry --format block >> AGENTS.md
```

The pasted block is invariant-shaped: paste once; stance evolution reaches
agents through the fetch pointer inside the block (`coggit entry --kind
standard`), not through re-pasting.

Hosts that read agent skills can also take the dispatch SOP that ships with
the CLI: `coggit skills` locates the `coggit` skill tree (`--json` for the
locator fields); copying or linking that whole directory into the host's
skills directory is the agent's own move — the command never writes it. The
skill carries the set-up / author / maintain sequences and points back to
`coggit entry`, `--help`, and `coggit handbook` for stance, mechanics, and
authoring rules.

dsh and MCP hosts do not need this — they inject the guidance through their
own adapter surfaces.

## Why This Matters

This workflow reduces agent drift. Instead of reconstructing local constraints from scattered evidence on every task, the agent starts from maintained cognition that already reflects the current implementation boundary.
