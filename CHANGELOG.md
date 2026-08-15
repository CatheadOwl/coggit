# Changelog

All notable changes to the CogGit extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/) and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Simplified `resolve` to a bare action: `resolve <path>` (CLI) and `coggit_resolve` (MCP) now accept the current source/cognition pair as reviewed, dropping the single-value `reviewed_unchanged` mode, the `--reviewed-unchanged` CLI flag, and the MCP `resolution` input parameter.

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
