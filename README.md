# CogGit

CogGit helps coding agents stay aligned with your codebase's local design intent. It pairs source code with a **cognition layer** — Markdown files that record local design intent, contracts, and invariants — and tracks their freshness against the code. When source changes without a matching cognition update, CogGit marks the pair stale and surfaces the evidence an agent needs to review it.

This repository is a pnpm-workspace monorepo with one package per delivery surface plus a reusable SDK.

## Packages

| Package | Directory | Identity | Role |
|---|---|---|---|
| VS Code extension | [`packages/vscode`](packages/vscode) | `coggit-vscode` (Marketplace VSIX) | Extension activation, Ghost Tree / Orphans / Misplaced views, `.mcp.json` UX, VSIX packaging. |
| CLI | [`packages/cli`](packages/cli) | `@coggit/cli` (npm, `bin: coggit`) | Command-line status / snapshot / routes / `mcp install`. |
| MCP runtime | [`packages/mcp`](packages/mcp) | `@coggit/mcp` (npm, `bin: coggit-mcp`) | MCP stdio runtime, tool/prompt registration, prompt assets. |
| SDK — core | [`packages/core`](packages/core) | `@coggit/core` | Runtime-agnostic kernel: registry, snapshot, status, routes. |
| SDK — runtime-node | [`packages/runtime-node`](packages/runtime-node) | `@coggit/runtime-node` | Node host primitives: fs, locks, watcher, registry adapter. |
| Shared format | [`packages/format`](packages/format) | `@coggit/format` (private, bundled) | Pure status/tree text rendering. |
| MCP runtime support | [`packages/mcp-runtime-support`](packages/mcp-runtime-support) | `@coggit/mcp-runtime-support` (private, bundled) | User-level MCP runtime install / launcher management. |

The published npm surface is `@coggit/cli`, `@coggit/core`, `@coggit/runtime-node`, and `@coggit/mcp`; the VS Code extension ships as a Marketplace VSIX, and `@coggit/format` / `@coggit/mcp-runtime-support` are private and bundled into their consumers.

## Quick start

Install the [CogGit VS Code extension](packages/vscode) from the Marketplace, open the **CogGit** view, and initialize a project. See [packages/vscode/README.md](packages/vscode/README.md) for the full extension guide.

## Development

```bash
pnpm install
pnpm run compile      # build all packages + typecheck + lint
pnpm run check-types  # typecheck every package
pnpm run lint         # eslint across package sources
pnpm run test         # compile tests + build + run the vscode-test suite
```

Package-level commands use pnpm filters, e.g. `pnpm --filter @coggit/cli build` or `pnpm --filter coggit-vscode run package:vsix`.

## Documentation

- [Design intent](docs/design-intent.md) — how CogGit relates to ADRs, PRDs, and source.
- [Agent workflow](docs/agent-workflow.md) — the routes -> read -> freshness loop.
