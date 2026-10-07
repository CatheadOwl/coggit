# @coggit/cli

CogGit CLI: source/cognition freshness status, snapshot, and MCP
install from the command line.

## Install

```sh
npm install -g @coggit/cli
```

## Usage

```sh
coggit init                  # initialize a CogGit project in the cwd
coggit status <source-path>  # freshness status for a source file or folder
coggit snapshot              # project-wide source/cognition snapshot
coggit orphans               # cognition files whose source is gone
coggit add / resolve         # register or accept a source/cognition pair
coggit instructions          # print agent guidance for CLI hosts (raw or AGENTS.md block; kind via --kind or positional)
coggit mcp install           # install the CogGit MCP stdio runtime
coggit watch                 # watch mode
```

Run `coggit --help` (or any command with `--help`) for the full option set.

## Related packages

- [`@coggit/core`](../core/README.md) — runtime-agnostic kernel (SDK)
- [`@coggit/runtime-node`](../runtime-node/README.md) — Node adapters (SDK)
- [`@coggit/mcp`](../mcp/README.md) — MCP stdio runtime

Architecture, concepts, and workflow docs live in the
[repository root](https://github.com/CatheadOwl/coggit#readme).
