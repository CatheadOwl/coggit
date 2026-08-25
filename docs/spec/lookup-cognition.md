# Cognition Lookup Spec

Supersedes [lookup-cognition.v1-deprecated.md](lookup-cognition.v1-deprecated.md).

## Purpose

`tryGetCognitionPath` answers one question: does this source path have an
existing paired cognition file, and where is it?

It is a projection, not an operation. It computes nothing new; it narrows the
already-computed `statusOperation` result down to the single thing a caller
needs: the existing cognition path, or nothing.

## Non-Goals

- Do not add a new core operation.
- Do not recompute source-path resolution, cognition-path mapping, or presence.
- Do not distinguish a source miss from "cognition not yet created" or "not
  applicable".
- Do not expose freshness detail, issues, triage, or action synthesis.

## Name

`tryGetCognitionPath`

Renamed from the v1 `lookupCognition` (see the deprecated v1 spec): the v1
surface was an operation, this one is a projection, and the `try` prefix names
the classic `TryGet` shape — no throw, and the caller checks whether a path
came back. `resolve` is already reserved in this repository for reviewed-pair
acceptance.

## Model

`tryGetCognitionPath` is a pure projection over `StatusOperationResult`:

```text
statusOperation(sourcePath)        ->  StatusOperationResult
tryGetCognitionPath(statusResult)  ->  { cognitionPath: string; stale: boolean } | null
```

Source-path resolution, presence detection, and path mapping all happen inside
`statusOperation`. `tryGetCognitionPath` only selects and re-encodes fields that
are already present. There is no new lookup logic, no second pass over the tree,
and no duplication of `resolveSourcePathWithHits` or `cognitionRelativePath`.

## Input Contract

`statusResult: StatusOperationResult`

- Required.
- Produced by `statusOperation` for the caller's `sourcePath` (and optional
  `sourcePathCandidates`).

`sourcePath` and `sourcePathCandidates` remain inputs to `statusOperation`,
unchanged from the existing surface. They are not inputs to `tryGetCognitionPath`.

## Output Contract

`tryGetCognitionPath` returns either a hit object or `null`:

- `null` — no existing paired cognition. This covers a source miss, a matched
  node with no cognition yet, and a node whose cognition is not applicable.
- `{ cognitionPath: string; stale: boolean }` — an existing paired cognition and
  its freshness.

`cognitionPath` is the existing paired cognition path (cognition-root-relative).
It is populated only on a hit; the `StatusOperationResult.cognitionPath`
"expected destination regardless of existence" encoding never leaks out of the
projection.

`stale` is true only when the node's own cognition is stale:
`statusResult.inspection.ownStatus === 'stale'`. `conflict` and descendant
status do not set it. On a hit, `stale` tells the caller to point the user at
`coggit status` for details; it never carries the diagnosis itself.

### Derivation

```text
statusResult.found === false                ->  null
inspection.cognitionPresence !== 'present'  ->  null
statusResult.cognitionPath === null         ->  null
otherwise                                   ->  { cognitionPath, stale }
```

where `cognitionPath` is `statusResult.cognitionPath` and `stale` is
`inspection.ownStatus === 'stale'`. The third row is a defensive guard, not a
reachable `statusOperation` outcome: `presence === 'present'` implies a
non-null cognition path.

## Why `null` Instead Of A Flag

The C# `bool TryGet(out path, out stale)` signature has a TypeScript equivalent:
`T | null`. The caller's null check is the `bool`. Encoding the outcome as a
nullable hit object avoids a `found` flag that can disagree with
`cognitionPath`, and keeps `stale` inside the hit object where it is meaningful.

Dropping the three-way `cognitionPresence` and the `found` flag is deliberate:
the caller of this surface does not need to tell "source path did not match"
from "cognition not yet created". Both mean "no path", and both fall through to
the same caller behavior.

## Relation to Existing Surfaces

- `status` owns freshness, issues, and action synthesis.
- `tryGetCognitionPath` projects a narrow "path + stale?" view out of `status`.
- `add` owns materialization.
- `resolve` owns reviewed-pair acceptance.

## Related

- [design-intent.md](../design-intent.md)
- [registry-path-contract.md](../registry-path-contract.md)
- [`statusOperation`](../../packages/core/src/operations.ts)
- [`CognitionCoveragePresence`](../../packages/core/src/status/statusTypes.ts)
- [lookup-cognition.v1-deprecated.md](lookup-cognition.v1-deprecated.md)
