# Changelog

All notable changes to `@coggit/core` are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/); versioning is semver.

## [0.3.0] - 2026-10-08

### Changed

- The `standard` system prompt's `roots` and `snapshot` segments are
  operationalized with the answering move: `roots` now reads "the status
  operation names both roots in its header", and the locate duty cites
  per-path status — which names the file's paired cognition document —
  instead of "the snapshot operation" (snapshot text mode never names
  cognition documents; per-path status does). The segment key stays
  `snapshot` as the stable host-override anchor. Zero surface spellings are
  preserved — the CLI-spelled orientation pointer lands in `@coggit/cli`'s
  access layer.
- The status presentations' missing-pair Cognition line now names the
  derivable mirror path — `Cognition: src_cognition/README.md (not created;
  add on demand)` — instead of hiding it behind the bare `Not created (add
  on demand)` (the bare form survives only for nodes with no expected
  cognition URI, e.g. error nodes). Every status call now discloses where
  the paired cognition document belongs, so the cognition root is
  discoverable from status output alone instead of by reading `.coggit`
  internals (eval evidence: 14/21 cli-host runs rummaged
  `.coggit/config.yaml`; `describeMissingCognition()` is the shared
  implementation for both renderers).

### Removed

- The `routes` operation and its supporting vocabulary: `routesOperation`,
  `RoutesOperationResult`, `CognitionRoutes`/`CognitionRoutesEntry`/
  `RoutesProjectionNode` types, the `buildCognitionRoutes` project port,
  the `routesProjection` presentation pipeline, and the
  `cognitionRoutes`/`cognitionDocumentFacts`/`cognitionTypes` cognition
  modules (their only consumers). `CORE_OPERATION_IDS` is now
  `['snapshot', 'status', 'add', 'resolve']`. The `standard`
  system prompt's `routes` segment is replaced by a `snapshot` segment.

## [0.2.1] - 2026-09-05

Patch release exercising the tag-triggered publish workflow (first CI
publish; no functional changes).

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
