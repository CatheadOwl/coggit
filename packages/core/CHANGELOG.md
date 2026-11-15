# Changelog

All notable changes to `@coggit/core` are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/); versioning is semver.

## [Unreleased]

### Changed

- `MINIMAL_SYSTEM_PROMPT` (version bumped to `system-prompt-v2`) is the
  paste-once ambient body: re-derived from the standard segment
  table (`mirror` / `records` / `snapshot` / `upkeep` byte-equal, plus the
  "Use it to explore the codebase." connective), trading the short hint for
  the invariant duties the pasted block must carry — the before-reading-
  source ordering joins the identity and keep-current directives. The
  standard form and its segment table are byte-identical to 0.5.1; the
  content contract (invariant element classes only) is test-pinned.

## [0.5.1] - 2026-11-03

### Added

- Point-query exclusion probe (`explainSourcePath`): adjudicates one
  source-root-relative path via `@catheadowl/pathscope`'s `explainScopePath`
  (0.2.0), returning the verdict plus the hit chain (preset name, gitignore
  layer anchor, stone hits) and the un-exclude projection. The engine options
  are the one constant the walk hooks and the probe both mount — probe
  verdicts cannot drift from walk verdicts. File-scheme roots only; remote
  schemes return `null` (the engine-level IO-injection face is a registered
  pathscope exit).
- Status misses carry an exclusion diagnosis: `coggit status <path>` on a
  missed path under a file-scheme project source root explains why the path
  is invisible to the scan (`Excluded from the scan scope of <id>: yes` /
  hit chain / `un-exclude:` action line) instead of a bare not-found. A path
  outside every scope, a non-file root, or any probe failure keeps the plain
  miss — the diagnosis never masks the miss.

### Changed

- `@catheadowl/pathscope` pins `^0.2.0` (the probe release; additive over
  0.1.1 — the walk face is unchanged, verified by the full suite on the
  registry build).

## [Unreleased]

## [0.5.0] - 2026-11-01

### Changed

- Source-tree exclusion swaps engines: the self-written `gitignore.ts` rule
  matcher and the hardcoded `sourceStructureIgnore.ts` name list retire, and
  traversal points adjudicate through `@catheadowl/pathscope`'s composable
  decision core (`createExclusionEngine` behind `createSourceExclusion`).
  Semantic adjudication (2026-10-24, decision record in `docs/decisions/`):
  the 23-entry hardcoded list is unmounted; cache trees ride the engine's
  `caches` preset, colliding build/deps names (`lib`, `vendor`, `build`,
  `dist`, `out`, `coverage`, `node_modules`) ride the `build`/`deps` presets
  and are un-excludable by a named gitignore negation (`!lib/`) — projects
  whose source legitimately lives in those directories are indexable again
  (the zero-escape-hatch bug). Nested repositories descend at any depth
  (2026-10-30 adjudication, decision 0002): the bridge mounts the engine's
  scanner alignment face — the source-root declaration is the registration,
  `.git` hits are report-not-cut (per-stone hit names, never a boolean),
  and a nested `.gitignore` is rules, not territory. Dot entries
  stay indexable (no blanket dot category; the retired engine's behavior).
  gitignore rules above the source root now inherit down from the enclosing
  git root, as git reads them. `files.exclude` merging on the VS Code side
  maps `enabled === true` entries to exclude patterns (the policy channel);
  the built-in floor is the engine's mounted presets — the old
  "add-only, never un-exclude" limitation dissolves via the gitignore hatch.
  Supply form: registry dependency on `@catheadowl/pathscope` `^0.1.1`
  (0.1.1, published 2026-10-31 — the `link:` transition window closed).

## [0.4.0] - 2026-10-17

### Changed

- The `standard` body's roots and locate segments drop the operationalization
  tails that duplicated the CLI access layer's orientation sentence ("the
  status operation names both roots in its header"; "which names the file's
  paired cognition document") — each naming claim now lives exactly once, in
  the CLI-spelled orientation sentence. Pre-registered A/B
  (exploratory 3/arm + confirmatory 5/arm): tied on pass count and
  first-coggit-touch median; the shorter form wins by pre-stated preference.
  Zero facts lost.

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
