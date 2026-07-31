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
coggit/src/core/README.md | Core layer - host-neutral application kernel...
coggit/src/extension.ts.md | Extension activation/deactivation entry point...
coggit/src/mcp-server/README.md | MCP server layer - shared MCP registration...
coggit/src/cli/README.md | Compiled Node CLI entrypoint for project commands...
```

Routes help the agent choose the right cognition file. They are not the final source of truth; they are the entry point into the paired cognition and source files.

## Suggested Instruction

Add a short instruction to your agent guide, such as `AGENTS.md`, `CLAUDE.md`, or your workspace instructions:

> Use CogGit to help explore the codebase. When changing code, keep the paired cognition up to date.

## Why This Matters

This workflow reduces agent drift. Instead of reconstructing local constraints from scattered evidence on every task, the agent starts from maintained cognition that already reflects the current implementation boundary.
