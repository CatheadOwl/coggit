# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- `CoggitInitTab.tsx` icon imports follow the host UI primitives' renamed
  exports: `Icon{Check,NewChat,Refresh}Outline16` →
  `Icon{...}OutlineRegular` (the host's visual-language overhaul replaced
  per-pixel fill glyphs with stroke weights; `Regular` is the one-pixel
  weight the host itself uses in compact toolbar/status contexts — TS's
  "did you mean `Medium`" hint is edit distance, not the right weight).
  Resolves the pre-existing `check-types` red (3× TS2305/TS2724) left by
  the host rename.

## [0.3.0] - 2026-09-23

### Added

- Prompt-surface config keys: `systemPromptKind` (`'minimal'` | `'standard'`,
  default `'minimal'` — `'standard'` fails loud until the installed
  `@coggit/core` provides it) and `cognitionLinkDirective` (default `true` —
  flipped on after three pilot rounds cleared it).
- `coggit:cognition-link` system-prompt section: the standing directive that
  binds the injected `[cognition-link]` lines and their `(stale)` / `(updated)`
  markers to a default action with an allowed, accounted deviation. The
  annotation channel writes the stale marker only when the target is actually
  stale, the prompt-middleware touch lane feeds the lines, and the
  cognition-link enricher carries a Settings-visible description.
- `coggit_status` delivers the core canonical text rendering; the
  optional-add and premature handbook hints stay out of the status surface
  (the status-surface role contract).
- Surface-contract tests (token stitching, frozen failure baseline) and the
  eval layer: surface comprehension review + the three-arm cognition-link
  adoption experiment (see `eval/README.md`; the experiment needs the dsh-eval
  behavior-experiment release and never runs in CI).

### Changed

- The web init UI moves from a `CogGit` tab under Settings → Built-in plugins
  to the plugin's row on the Plugins page (follows the upstream 2026-09-16
  move of the plugins-configuration home): the `@coggit/dsh` row now carries
  a Configure control opening the same initializer — a one-line summary on
  the row, the form and its RPC write path unchanged. Registration slot
  `settings.plugins.tab` → `plugins.row.config` (key `@coggit/dsh#coggit`),
  locale namespace `settings.coggit` → `plugins.coggit`, and the settings
  client-half peers swap for `@deepseek-ai/dsh-client-ui-plugin-manager`.
  Requires a host whose web frontend ships the Plugins-page config slots
  (upstream ≥ 2026-09-16); on older hosts the config UI is simply absent —
  the server half (service facade + `coggit_*` tools) is unaffected.
- The `coggit-misplaced` gate registration is back on the gates service seam:
  local structural mirrors of the frozen gate contract + the
  `ctx.inject(['gates'], ...)` soft dependency (same shape as the
  cognition-link provider), replacing the hard-import
  `@catheadowl/dsh-extras/gates/register` face — extras retired that face in
  its 0.3.2 line. The `@catheadowl/dsh-extras` dependency is removed: the
  `gates` / `enrichment` seams are consumed purely as optional co-installed
  plugins, no package dependency.
- Follows the 2026-09-22 upstream engine-word rename (`promptMiddleware` →
  `enrichment`): the cognition-link soft dependency registers under the
  `enrichment` inject key; the frozen touch-lane envelope/key/sensor
  vocabulary is untouched.

### Fixed

- Client workspace resolution drops the global current-session tier removed
  by the host 0.1.6-alpha.2 session-ownership refactor: falls back to the
  most recently active workspace (latest session `updatedAt`, `createdAt`
  recency for session-less workspaces, host order tie-break); the server-cwd
  fallback is unchanged. Restores the client half against current hosts.
- Cognition-link rendering keeps session-scoped render state with per-path
  failure isolation — one failing path no longer poisons the section.

## [0.2.1] - 2026-09-06

### Added

- First npm release. `@coggit/dsh` is the CogGit runtime adapter
  for dsh: a `ctx.coggit` service facade and model-facing `coggit_*` tools
  over the published CogGit SDK (`@coggit/core`, `@coggit/runtime-node`).
- Conditional injection: workspaces without a `.coggit/config.yaml` get no
  `coggit:overview` section and no `coggit_*` tool schemas.
- Web client bundle (`./client` export) for the dsh web profile, plus the
  Cordis runtime patch declaration (`cordis.patch.yml`).

### Changed

- Version line aligned with the SDK (`0.2.x`); the SDK pair is consumed from
  the npm registry (`^0.2.0`) instead of dev-time `link:` references.
- Corrected the published name to `@coggit/dsh` (the `@coggit` org series).
  The same content briefly shipped as `@catheadowl/dsh-coggit@0.2.1`; that
  package is deprecated — reinstall as `@coggit/dsh`. The rename changes the
  plugin identity (`cordis.patch.yml` name included), so profiles holding the
  old plugin entry must re-add the package.
