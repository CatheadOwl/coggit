# Changelog

All notable changes to `coggit` (CLI) are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/); versioning is semver.

## [0.2.0] - 2026-09-05

Initial npm publish (`npm i -g coggit`). `0.2.0` matches the monorepo split
source; there is no npm release for `0.1.0`.

### Added

- `coggit` bin: source/cognition freshness status, snapshot, routes, and MCP
  install from the command line.
- Consumes the published SDK (`@coggit/core` + `@coggit/runtime-node`) as real
  registry dependencies; internal helpers (`format`, `mcp-runtime-support`)
  and `commander` are bundled — no private packages in the dependency tree.
