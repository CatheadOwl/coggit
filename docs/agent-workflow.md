# Agent Workflow

CogGit is useful when an agent needs local design context while changing code.

The practical loop is simple:

1. Use `routes` to find the relevant cognition document.
2. Read the paired cognition before broad source inspection.
3. Check freshness and evidence before deciding whether the cognition needs an update.
4. Keep the cognition aligned when the code changes.

## Routes

The `routes` tool gives a compact overview of the cognition layer before diving into source:

```text
coggit/packages/core/src/README.md | Core layer - host-neutral application kernel...
coggit/packages/vscode/src/extension.ts.md | Extension activation/deactivation entry point...
coggit/packages/mcp/src/README.md | MCP server layer - shared MCP registration...
coggit/packages/cli/src/README.md | Compiled Node CLI entrypoint for project commands...
```

Routes help the agent choose the right cognition document. They are not the final source of truth; they are the entry point into the paired cognition and source files.

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
