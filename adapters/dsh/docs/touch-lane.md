# Touch Lane Consumer Design (cognition-link × prompt-middleware W11)

Status: active · Scope: `@coggit/dsh` consumer side only. Framework authority lives
with the prompt-middleware project (dsh-extra): its workunit ADR series records
the tool-touch sensor seam and the touchSubjects lane decisions, and the
`tool-touch sensor lane` section of `modules/prompt/docs/contract.md` in the
extras checkout carries the current contract. This document records
only how this adapter declares and renders; it does not restate framework
decisions.

## Dependency channel

- Consumes the W11 API face (`sources`, `touchSubjects`, pseudo-path metadata
  `origin` / `touchTool`) via `@catheadowl/dsh-extras`, registry range after the
  carrying release; until then a local resolution channel (`link:` to the
  dsh-extra extras checkout, DEP-2) — dev-only, not committed.
- Hard constraint (a consequence of the sensor-seam decision referenced above):
  this plugin never attaches its own `tools/result` hook; everything goes
  through the declarative API.

## Declaration

On the existing `registerRelates` provider:

```ts
sources: ['prompt', 'touch'],
touchSubjects(touchedPath, context) {
  // context: TouchSubjectContext { cwd, sessionId? } — the session cwd the
  // sensor normalized the path against (record time) / the step's cwd (pre-step)
  if (isSourceSide(touchedPath)) return [touchedPath]
  const paired = pairedSourceOf(touchedPath) // *.ts.md / folder README.md -> paired source
  return paired !== undefined ? [paired, touchedPath] : []
},
```

`touchSubjects` and the prompt-side subject (the mentioned path itself — no
`subjectOf`) must land in the same subject space, or cross-source once-dedupe
does not engage. The projection is pure string work over the roots of
`context.cwd`, composed from the `@coggit/core` public pairing classification
(`projectRelativePair`) — no new SDK surface required.

Known limitation: the framework's `TouchSubjectContext` (`cwd` + optional
`sessionId`) identifies the project, but roots come from the async project
discovery while `touchSubjects` is synchronous. The provider keeps a
`Map<cwd, roots>` warmed by every turn (`resolve` sees `input.cwd`) and
consulted through `context.cwd`; an unwarmed cwd returns no subjects and is
warmed in the background for the next call. The residual cold start is one
missed invalidation for the first touches of a brand-new cwd — never a wrong
injection, and no cross-project union contamination (the earlier union-cache
degradation is retired by this context-based lookup).

## Pseudo-paths and origin metadata

Touches re-offered as subjects enter `resolve` as pseudo-paths with
`origin: 'touch'` and `touchTool: 'read' | 'edit'` (open string, closed set by
convention). `path.origin` / `path.touchTool` distinguish the agent's own
actions (`edit`) from organic reads. At record time the same touch reaches
`touchSubjects` with `TouchSubjectContext` (`cwd`, `sessionId?`).

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
