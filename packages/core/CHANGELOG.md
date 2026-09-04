# Changelog

All notable changes to `@coggit/core` are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/); versioning is semver.

## [0.2.0] - 2026-09-05

Initial npm publish. `0.2.0` matches the monorepo split source (the
physical-split and published-surface decisions); there is no npm release for
`0.1.0`.

### Added

- Public `.` export surface: source/cognition freshness semantics, registry,
  snapshot, status, and operations, assembled via `createCoggitServices` port
  contracts.
- `./internal` subpath for trusted monorepo consumers (the published `coggit`
  CLI); ships in the tarball with no third-party stability promise.
- Zero runtime dependencies (`yaml` is bundled at build time).
