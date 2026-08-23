# CogGit

CogGit is a VS Code extension for tracking source-linked Markdown cognition files and their freshness against your codebase.

It helps agents and humans see local design intent without rebuilding it from scratch. Each cognition file records the current intent, contracts, and boundaries for a source file or folder. Think of these files as small "materialized views" over your codebase architecture: easy to read, review, and update when the code changes.

When source changes without a matching cognition update, CogGit marks the pair as stale and shows the evidence an agent can use to review or update it.

## Highlights

- Freshness tracking for source and cognition pairs, focused on what is fresh and what needs review.
- Evidence that helps agents decide whether to update cognition or mark a reviewed pair as current.
- A source-shaped Ghost Tree for navigating code and cognition side by side.
- Workspace `.mcp.json` setup for giving agents direct access to CogGit status and route tools.

## Quick Start

1. Install CogGit from the VS Code Marketplace.
2. Open the **CogGit** view from the Activity Bar.
3. Click **Initialize Project** and choose the source directory to track.
4. Use the **Ghost Tree** to create, open, and review cognition files.
5. Use **Configure CogGit MCP** to add CogGit to your workspace `.mcp.json`.

## What CogGit Tracks

Cognition files mirror your source tree. Each source file gets a leaf `.md`; each folder gets a skeleton `README.md`:

```text
src/                        src_cognition/
  core/                       core/
    registry.ts                 registry.ts.md
    operations.ts               operations.ts.md
                                README.md    # skeleton for core/
  cli/                        cli/
    main.ts                     main.ts.md
                                README.md    # skeleton for cli/
```

Cognition files are plain Markdown. They are meant to stay small and current: leaf files capture local design intent, while folder README files capture the contracts and boundaries that hold a module together.

The **Ghost Tree** shows this map with live freshness status, like `git status` for your architecture.

## Learn More

- [Design Intent and Existing Docs](docs/design-intent.md) explains how CogGit fits with ADRs, PRDs, comments, and source code.
- [Agent Workflow](docs/agent-workflow.md) shows how agents use routes, freshness status, and paired cognition while changing code.

## VS Code Features

- A Ghost Tree for source/cognition navigation with live freshness status.
- Context actions for creating cognition files and opening paired source or cognition documents.
- Orphan and misplaced cleanup views for cognition files whose source disappeared or whose mirror path no longer matches.
- Filters for focusing on tracked cognition or selected file extensions.

## MCP for Agents

CogGit includes an MCP server for agent workflows.

Use **Configure CogGit MCP** to add a `coggit` server entry to your workspace `.mcp.json`. CogGit only writes `mcpServers.coggit` and preserves other server entries.

Agents can use CogGit to inspect freshness status and evidence, browse cognition routes, create missing cognition files, and mark reviewed pairs as up to date. See [Agent Workflow](docs/agent-workflow.md).

Suggested agent instruction:

> Use CogGit to help explore the codebase. When changing code, keep the paired cognition up to date.

## Safety Model

- Project initialization is explicit.
- `.mcp.json` changes are command-driven and scoped to `mcpServers.coggit`.
- Existing MCP server entries are preserved.
- Cognition files remain plain Markdown under your project control.

## Release Notes

### 0.1.0

First preview: Ghost Tree, cognition creation, freshness tracking, and MCP setup for agents.
