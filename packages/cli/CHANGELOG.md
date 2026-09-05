# Changelog

All notable changes to `@coggit/cli` are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/); versioning is semver.

## [Unreleased]

### Added

- `coggit -v` / `coggit --version`: print the CLI version (wires the
  `__COGGIT_PACKAGE_VERSION__` build macro into commander's `.version()`).

## [0.2.1] - 2026-09-05

Patch release exercising the tag-triggered publish workflow (first CI
publish; no functional changes).

## [0.2.0] - 2026-09-05

Initial npm publish (`npm i -g @coggit/cli`; the `coggit` bin name is
unchanged — the unscoped `coggit` registry name was rejected as too similar
to the existing `cz-git` package). `0.2.0` matches the monorepo split
source; there is no npm release for `0.1.0`.

### Added

- `coggit` bin: source/cognition freshness status, snapshot, routes, and MCP
  install from the command line.
- Consumes the published SDK (`@coggit/core` + `@coggit/runtime-node`) as real
  registry dependencies; internal helpers (`format`, `mcp-runtime-support`)
  and `commander` are bundled — no private packages in the dependency tree.
