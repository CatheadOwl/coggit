# Changelog

All notable changes to `@coggit/runtime-node` are documented here. Format
follows [Keep a Changelog](https://keepachangelog.com/); versioning is semver.

## [0.5.1] - 2026-11-03

### Changed

- `@parcel/watcher` becomes an optional peer instead of a hard dependency —
  watch is opt-in. Trees that never watch (adapters, service-only consumers)
  install no native watcher at all, so the package manager's build-script
  approval gate has no object there and installs stop prompting for it.
  Constructing the watcher observer without the peer present throws a typed
  error naming the missing peer and its install fix (watch stays a
  type-level import; the resolution is a guarded `require` at observer
  construction). The published CLI carries the watcher as its own direct
  dependency, so its watch daemon is unaffected.

## [0.5.0] - 2026-11-01

Lockstep with the 0.5.0 wave (source-exclusion engine swap in
`@coggit/core`). No functional changes of its own — consumers riding
this runtime inherit the core engine's exclusion semantics transitively.

## [0.4.0] - 2026-10-17

Lockstep with the 0.4.0 wave (cli entry rename, core standard-body
dedup); rides the fixed tag-publish list. No functional changes since
0.2.1 (docs only).

## [0.3.0] - 2026-10-08

Lockstep with the 0.3.0 wave (core routes retirement); rides the fixed
tag-publish list. No functional changes since 0.2.1 (docs only).

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
