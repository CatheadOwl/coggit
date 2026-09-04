# Changelog

All notable changes to `@coggit/runtime-node` are documented here. Format
follows [Keep a Changelog](https://keepachangelog.com/); versioning is semver.

## [0.2.1] - 2026-09-05

Patch release exercising the tag-triggered publish workflow (first CI
publish; no functional changes).

## [0.2.0] - 2026-09-05

Initial npm publish. `0.2.0` matches the monorepo split source; there is no
npm release for `0.1.0`.

### Added

- Public `.` export surface: local filesystem, config, registry, lock, URI,
  and service-construction primitives, including
  `createNodeCoggitServices` for one-call assembly.
- `./internal` subpath for trusted monorepo consumers (the published `coggit`
  CLI); ships in the tarball with no third-party stability promise.
- Runtime dependencies: `@coggit/core` and `@parcel/watcher` (native binding,
  externalized and declared).
