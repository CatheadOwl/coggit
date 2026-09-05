# CogGit

Agents can read code, but they repeatedly reconstruct local design context from scattered evidence. CogGit gives them a maintained, source-shaped design surface so they can act with less drift.

CogGit helps coding agents stay aligned with your codebase's local design intent. It pairs source code with a **cognition layer** — Markdown files that record local design intent, contracts, and invariants — and tracks each pair's freshness against the code. When source changes without a matching cognition update, CogGit marks the pair for review and surfaces the evidence an agent needs to realign it.

## Cognition files

The cognition tree mirrors the source tree:

```text
src/                        src_cognition/
  watchHost.ts                watchHost.ts.md      ← leaf (pairs a file)
  registry/                   registry/
    index.ts                    index.ts.md
                                README.md           ← skeleton (pairs a folder)
```

Two kinds of documents: **leaves** pair a source file; **skeletons** pair a directory (its `README.md`). Both are plain Markdown that record what code cannot say alone — why a choice exists, what was rejected, which boundaries must hold. See the [leaf template](packages/core/src/cognition/leaf-template.md) and [leaf handbook](packages/core/src/cognition/leaf-handbook.md) for the expected shape.

## Freshness

Fresh means the pair was verified against the current source:

```console
$ coggit status src/watchHost.ts
Status: Fresh
Source: src/watchHost.ts
Cognition: src_cognition/watchHost.ts.md

Own issues: 0
```

When source changes without a cognition update, the pair is marked **stale** — a signal to review, not a verdict that the cognition is wrong:

```console
$ coggit status src/watchHost.ts
Status: Stale
Source: src/watchHost.ts
Cognition: src_cognition/watchHost.ts.md

Legend:
WARN  stale-cognition  Cognition is out of date with source.

Actions:
sync-leaf  Read leaf handbook and sync cognition with source.
resolve    Accept the reviewed pair after sync.

Own issues: 1
WARN | stale-cognition | source=src/watchHost.ts | actions=sync-leaf,resolve
```

After you review and sync the cognition, `coggit resolve` records the pair as reviewed — an explicit acceptance: you do the review, resolve records it. A whole-tree view (`coggit snapshot`) shows where drift lives:

```console
$ coggit snapshot
coggit-demo [Stale]
  watchHost.ts [Stale]
```

## Surfaces

One local design-context runtime, four ways in:

| Surface | Entry | Role |
|---|---|---|
| VS Code extension | `coggit-vscode` (Marketplace) | Authoring surface — Ghost Tree / Orphans / Misplaced views, watcher, MCP config UX. |
| CLI | `@coggit/cli` (npm, `coggit`) | Terminal — status / snapshot / routes / add / resolve. |
| MCP runtime | `@coggit/mcp` (npm, `coggit-mcp`) | Agent-facing tools + handbooks over stdio. |
| dsh adapter | `@coggit/dsh` (npm, `dsh plugin add @coggit/dsh`) | `coggit_*` tools, handbook skills, and cognition links inside a dsh session. |

This repository is a pnpm-workspace monorepo with one package per delivery surface plus a reusable SDK:

| Package | Directory | Identity | Role |
|---|---|---|---|
| VS Code extension | [`packages/vscode`](packages/vscode) | `coggit-vscode` (Marketplace VSIX) | Extension activation, Ghost Tree / Orphans / Misplaced views, `.mcp.json` UX, VSIX packaging. |
| CLI | [`packages/cli`](packages/cli) | `@coggit/cli` (npm, `bin: coggit`) | Command-line status / snapshot / routes / `mcp install`. |
| MCP runtime | [`packages/mcp`](packages/mcp) | `@coggit/mcp` (npm, `bin: coggit-mcp`) | MCP stdio runtime, tool/prompt registration, prompt assets. |
| SDK — core | [`packages/core`](packages/core) | `@coggit/core` | Runtime-agnostic kernel: registry, snapshot, status, routes. |
| SDK — runtime-node | [`packages/runtime-node`](packages/runtime-node) | `@coggit/runtime-node` | Node host primitives: fs, locks, watcher, registry adapter. |
| Shared format | [`packages/format`](packages/format) | `@coggit/format` (private, bundled) | Pure status/tree text rendering. |
| MCP runtime support | [`packages/mcp-runtime-support`](packages/mcp-runtime-support) | `@coggit/mcp-runtime-support` (private, bundled) | User-level MCP runtime install / launcher management. |

The published npm surface is `@coggit/cli`, `@coggit/core`, `@coggit/runtime-node`, `@coggit/mcp`, and `@coggit/dsh`; the VS Code extension ships as a Marketplace VSIX, and `@coggit/format` / `@coggit/mcp-runtime-support` are private and bundled into their consumers. The dsh adapter lives in this repository as an independent sibling project under [`adapters/dsh`](adapters/dsh) with its own install — see its README.

## Quick start

```console
# VS Code — install "CogGit" from the Marketplace, open the CogGit view, initialize a project

# CLI
npm install -g @coggit/cli
coggit init            # create the cognition layer
coggit add <path>      # create a paired cognition document
coggit status <path>   # check freshness

# MCP — user-level runtime launcher
coggit mcp install

# dsh — adapter plugin for dsh agents
dsh plugin add @coggit/dsh
```

A recommended agent instruction:

> Use CogGit to help explore the codebase. When changing code, keep the paired cognition up to date.

## Development

```bash
pnpm install
pnpm run compile      # build all packages + typecheck + lint
pnpm run check-types  # typecheck every package
pnpm run lint         # eslint across package sources
pnpm run test         # unit tests (build + mocha)
pnpm run test:integration  # vscode-test suite
```

Package-level commands use pnpm filters, e.g. `pnpm --filter @coggit/cli build` or `pnpm --filter coggit-vscode run package:vsix`.

## Documentation

- [Design intent](docs/design-intent.md) — how CogGit relates to ADRs, PRDs, and source.
- [Agent workflow](docs/agent-workflow.md) — the routes → read → freshness loop.
