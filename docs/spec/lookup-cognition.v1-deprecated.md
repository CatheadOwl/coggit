# Cognition Lookup Spec (v1 — deprecated)

> **Deprecated.** This spec defined `lookupCognition` as a new core operation.
> It has been superseded by [lookup-cognition.md](lookup-cognition.md), which
> renames the surface to `tryGetCognitionPath` and redefines it as a projection
> over `statusOperation`. Retained for reference only; do not implement against
> this version.

This document defines the lightweight source-to-cognition lookup surface for
CogGit. It is narrower than `status` by design.

## Purpose

`lookupCognition` answers one question: does this source path have a paired
cognition file, and where is it?

It is a discovery surface, not a freshness diagnosis surface.

## Non-Goals

- Do not replace `status`.
- Do not expose subtree issues or triage.
- Do not duplicate resolve / acceptance semantics.
- Do not force callers to infer cognition presence from a path string.

## Name

`lookupCognition`

`resolve` is already reserved in this repository for reviewed-pair acceptance,
so it is not a good fit for this query surface.

## Input Contract

`sourcePath`

- Required.
- Source-root-relative.
- Uses the same source-path matching rules as the existing status / add /
  snapshot lookup flow.

`sourcePathCandidates?`

- Optional.
- Expands alternate candidate paths before lookup.
- Same semantics as other source-path lookup operations.

## Output Contract

The core result should stay small and explicit:

- `found`: whether a source node matched
- `sourcePath`: canonical matched source path when found, otherwise the input
- `project`: matched project when found, otherwise `null`
- `nodeKind`: matched node kind when found, otherwise `null`
- `cognitionPath`: expected paired cognition path, or `null`
- `cognitionPresence`: `present | missing | not-applicable`
- `nextHint`: optional short guidance for the next operation
- `pathHints`, `pathMissMessage`, `pathHintMessage`: miss recovery data

`cognitionPath` is the expected destination, not an existence check.
`cognitionPresence` is the existence fact.

## Next Hint

`nextHint` is advisory only.

Recommended guidance:

- `present` -> point to `status` when the caller needs freshness or issue
  details
- `missing` -> point to `add` when the caller wants to materialize cognition
- `not-applicable` -> no follow-up action by default

The lookup surface should not promise full freshness detail. If a caller needs to
know whether cognition is stale, `status` remains the authoritative surface.

## DTO / Presentation

Do not add a status-shaped DTO to this surface.

The core result should be the canonical contract. If CLI or MCP needs a compact
presentation, they may project a lookup-specific present/miss view from the same
core result, but that view should stay lookup-specific:

- present: show source, cognition path, presence, and next hint
- miss: show path hints and miss recovery text

Do not add own/descendant issue arrays, triage, or status aggregation to the
lookup presentation.

## Relation to Existing Surfaces

- `status` owns freshness, issues, and action synthesis.
- `lookupCognition` owns pairing discovery.
- `add` owns materialization.
- `resolve` owns reviewed-pair acceptance.

## Related

- [design-intent.md](../design-intent.md)
- [registry-path-contract.md](../registry-path-contract.md)
- [`statusOperation`](../../packages/core/src/operations.ts)
