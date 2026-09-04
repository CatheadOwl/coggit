# Changelog

All notable changes to `@coggit/mcp` are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/); versioning is semver.

## [0.2.1] - 2026-09-05

Patch release exercising the tag-triggered publish workflow (first CI
publish; no functional changes).

## [0.2.0] - 2026-09-05

Initial npm publish. `0.2.0` matches the monorepo split source; there is no
npm release for `0.1.0`.

### Added

- `coggit-mcp` bin: MCP stdio server exposing the CogGit status/snapshot/
  routes/operations surface as tools.
- Public `.` export: protocol registration and tool definitions.
- `@modelcontextprotocol/sdk` as a peer dependency; the MCP SDK and `zod` are
  bundled at build time.
