# Touch Lane Consumer Design (cognition-link × prompt-middleware W11)

Status: active · Scope: `@coggit/dsh` consumer side only. Framework authority lives
with the prompt-middleware project (dsh-extra): the sensor-seam decision (tool-touch sensor seam),
the touchSubjects-lane decision (touchSubjects lane C), and the `tool-touch sensor lane` section of
`modules/prompt/docs/contract.md` in the extras checkout. This document records
only how this adapter declares and renders; it does not restate framework
decisions.

## Dependency channel

- Consumes the W11 API face (`sources`, `touchSubjects`, pseudo-path metadata
  `origin` / `touchTool`) via `@catheadowl/dsh-extras`, registry range after the
  carrying release; until then a local resolution channel (`link:` to the
  dsh-extra extras checkout, DEP-2) — dev-only, not committed.
- Hard constraint (the sensor-seam decision consequence): this plugin never attaches its own
  `tools/result` hook; everything goes through the declarative API.

## Declaration

On the existing `registerRelates` provider:

```ts
sources: ['prompt', 'touch'],
touchSubjects(touchedPath) {
  if (isSourceSide(touchedPath)) return [touchedPath]
  const paired = pairedSourceOf(touchedPath) // *.ts.md / folder README.md -> paired source
  return paired !== undefined ? [paired, touchedPath] : []
},
```

`touchSubjects` and the prompt-side subject (the mentioned path itself — no
`subjectOf`) must land in the same subject space, or cross-source once-dedupe
does not engage. The projection is pure string work over the workspace roots
(see `projectTouchedPath` in `cognition-link-provider.ts`), composed from
`@coggit/core` mapping helpers (`cognitionIdentityToSourceIdentity`,
`sourceIdentityToProjectRelative`, `toRelativeUriPath`) — no new SDK surface
required.

Known limitation: the framework calls `touchSubjects(path)` without session
context, while root names are per-project config data. The provider therefore
keeps a roots cache refreshed on every turn (`resolve` receives `input.cwd`)
and projects against the union of cached roots. Cold-start touches recorded
before the first resolve of a session degrade to a missed invalidation — the
worst case is a repeat suppression, never a wrong injection. The structural
fix (session context at record time) belongs to the framework, filed there.

## Pseudo-paths and origin metadata

Touches re-offered as subjects enter `resolve` as pseudo-paths with
`origin: 'touch'` and `touchTool: 'read' | 'edit'` (open string, closed set by
convention). `path.origin` / `path.touchTool` distinguish the agent's own
actions (`edit`) from organic reads.

## Rendering policy (lives entirely on this side)

The framework does pending, invalidation, re-run; what a re-run says is the
provider's business. `lastRendered` is a provider-closure `Map<subject,
{ cognitionPath, stale }>` — session-memory, no persistence; snapshot reuse
keeps the existing `input.turnId` closure pattern.

| Source | Transition | Action |
|---|---|---|
| touch + edit (self) | any | reconcile: refresh `lastRendered`, return `undefined` |
| touch + read / prompt | never → fresh | cognition-link item (stale false) |
| touch + read / prompt | never → stale, or fresh → stale | cognition-link item (stale marker is the warning) |
| any | state flipped with a previous render | item again, plus `updated: 'true'` meta (append-only history: one cheap line, no rewrite of past injections) |
| any | no transition | `undefined` (steady state: one snapshot query per touch, zero injection) |

State pair v1 is `{ cognitionPath, stale }`. Cognition-content-only changes
(same path, same staleness) are not detected; upgrading the state pair to a
cognition content identity is a local change when needed.

## Framework interactions (settled upstream)

- A disabled provider's `run` never executes, but its `touchSubjects`
  declaration still participates in invalidation.
- `resolve` throwing records a `failed` trace; other providers and the turn
  are unaffected.
- `write` is not in the touch closed set: newly created files rely on prompt
  mention (resolve is naturally `undefined` when no cognition exists).

## Defer items (reopen with zero framework change)

- `write` entering the closed set.
- Cognition-side write invalidation: one extra mapping line in `touchSubjects`
  (already covered by the reverse projection above).
