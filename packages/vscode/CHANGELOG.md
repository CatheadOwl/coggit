# Changelog

All notable changes to the CogGit extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/) and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.5.1] - 2026-11-03

Lockstep with the 0.5.1 wave. No extension changes of its own — the
manifest realigns to the wave line after the 0.5.0 identity-flip restore
wiped its version bump (the CHANGELOG kept that section); the Marketplace
upload remains the owner-shelved standing item.

## [0.5.0] - 2026-11-01

Lockstep with the 0.5.0 wave (source-exclusion engine swap in
`@coggit/core`). No extension changes of its own — the bundled core's new
exclusion semantics are user-visible through the extension's scans:
nested repositories inside a declared source root are indexed, source in
`lib`/`vendor`-style directories is indexable via a named gitignore
negation, and gitignore rules inherit from the enclosing git root.

## [0.4.0] - 2026-10-17

Lockstep with the 0.4.0 wave (cli entry rename, core standard-body
dedup). No extension changes since 0.3.0 — the extension never names the
CLI guidance command; the bundled MCP server re-voices the deduped
segments from its own override.

## [0.3.0] - 2026-10-08

### Removed

- The bundled MCP server no longer registers a `coggit_routes` tool — the
  `routes` operation is retired from CogGit entirely. Agents orient
  with `coggit_snapshot` or the mirror convention instead.

### Changed

- Simplified `resolve` to a bare action: `resolve <path>` (CLI) and `coggit_resolve` (MCP) now accept the current source/cognition pair as reviewed, dropping the single-value `reviewed_unchanged` mode, the `--reviewed-unchanged` CLI flag, and the MCP `resolution` input parameter.

## [0.2.1] - 2026-09-05

### Notes

- Republished from CI with OIDC trusted publishing; no user-facing changes versus 0.2.0.

## [0.2.0] - 2026-08-04

### Added

- Added fuzzy source-path suggestions when CLI or MCP commands cannot find a requested source path.
- Exposed source-path suggestions in MCP structured output so agents can recover from path misses more reliably.

### Changed

- Improved how CogGit detects and refreshes project state after files or configuration change.

### Fixed

- Fixed watcher evidence recording for observation counts and source-root directory changes.
- Fixed Node watcher handling for config changes, rename/recreate races, and events without filenames.

## [0.1.0]

### Added

- Ghost Tree, Orphans, and Misplaced views with live status decorations.
- Commands for project initialization, cognition creation, filtering, status copy, and misplaced cognition moves.
- Explicit command for configuring the CogGit MCP server in workspace `.mcp.json`.
- MCP setup for agent workflows through workspace `.mcp.json`.
- MCP server exposing status, snapshot, routes, add, and reviewed-unchanged resolve workflows.
- Marketplace metadata, release icons, and VSIX packaging support.

## [0.0.1]

- Initial internal CogGit extension build.
