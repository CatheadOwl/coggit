# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2026-09-06

### Added

- First npm release. `@catheadowl/dsh-coggit` is the CogGit runtime adapter
  for dsh: a `ctx.coggit` service facade and model-facing `coggit_*` tools
  over the published CogGit SDK (`@coggit/core`, `@coggit/runtime-node`).
- Conditional injection: workspaces without a `.coggit/config.yaml` get no
  `coggit:overview` section and no `coggit_*` tool schemas.
- Web client bundle (`./client` export) for the dsh web profile, plus the
  Cordis runtime patch declaration (`cordis.patch.yml`).

### Changed

- Version line aligned with the SDK (`0.2.x`); the SDK pair is consumed from
  the npm registry (`^0.2.0`) instead of dev-time `link:` references.
