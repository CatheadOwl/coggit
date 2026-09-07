---
description: Design analysis of stale sourcePath entries after bulk source renames — why atomic re-key conflicts with the cognition-identity key model, and what the real defect is.
---

# Rename relocation consistency

Design analysis for the registry source-rename defect observed on 2026-08-23
(meta TODO: `TODO/ISSUES/20260823-1744-source-rename-reconcile-non-atomic-stale-sourcepath.md`).

> [2026-09-07 correction] The incident was resolved in coggit@b2df5bd while
> this analysis was being formalized: `applySourceRename` early-returned after
> the direct relocation (parent prefix never applied to bulk per-file events),
> and parent inference required basename preservation. The two mechanisms
> proposed below as the root cause were therefore **not** what produced the
> incident: the folder-record claim below is wrong about the code
> (`relocateSourcePath`'s leading equality branch rewrites the node itself for
> `prefix` relocations), and the order-dependence, while real, did not fire
> under early-return. Both remain *latent* fragilities of
> `applyRegistrySourceRelocations` and are the basis of the proposed hardening
> (meta the closed-set batch relocation design + spec). Read the sections below as that hardening case, not
> as the incident explanation; the authoritative incident record is the
> Resolution section of the TODO issue.

## Symptom recap

A 21-file `git mv` out of `src/mcp-server` left two registry entries with stale
`sourcePath` fields after rename reconcile:

1. `packages/mcp/src/mcp-stdio.ts` kept `sourcePath: src/mcp-stdio/main.ts` —
   a filename rename (`main.ts` -> `mcp-stdio.ts`) inside a moved directory.
2. `packages/mcp/src/` (folder record) kept `sourcePath: src/mcp-server` — a
   folder collapse (`src/mcp-server` -> `packages/mcp/src`).

Keys were reconciled correctly in both cases; only `sourcePath` went stale.

## The key identity model rules out "atomic re-key"

The issue's original Design Direction ("derive the new key from the new
`sourcePath` in the same locked write") conflicts with the stated key model:

- Registry keys are **cognition-root-derived identities** (see the core
  registry boundary cognition, `Path Contract` section). `sourcePath` is the
  mutable source binding, not the identity.
- A source rename moves source files only. The paired cognition file may not
  move at all (agent/user moves it later), and for misplaced cognition the key
  is intentionally a cognition-path key that differs from
  `sourcePathToKey(sourcePath)`.
- `applySourceRenameRelocations` documents this deliberately: keys stay
  untouched and are re-derived by reconcile once cognition files move.

Therefore there is **no invariant `key === sourcePathToKey(sourcePath)`** to
restore atomically, and forcing a re-key inside the rename write would fight
the model (it would re-key entries whose cognition file has not moved,
producing keys that point at cognition paths that do not exist). The
"non-atomicity" named in the issue is by design at the key level; the real
defect is narrower and lives entirely in the `sourcePath` rewrite set.

## Root cause: the relocation set is not closed under the observed move shapes

The relocation vocabulary (`RegistrySourceRelocation`) has exactly two shapes:

- `exact`: rewrites only the entry whose `sourcePath` equals `fromSourcePath`.
- `prefix`: rewrites only strict descendants (`fromSourcePath + '/'` prefix);
  the node itself is never matched by its own prefix relocation.

Two consequences produce the two stale entries:

1. **Folder's own record never matches.** A directory move is inferred as
   `kind: 'prefix'` (`inferRegistrySourceRelocation`), and
   `inferRegistrySourceParentRelocation` also produces prefixes. Nothing in the
   set rewrites the folder record's own `sourcePath` (`src/mcp-server`). This
   is defect (2) above, and it reproduces on any plain directory rename — the
   2026-08-23 bulk move merely made it visible.
2. **Sequential relocation application is order-dependent.** Per-file rename
   events from one bulk move arrive as separate `applySourceRename` calls, and
   inside one call the batch is applied entry-by-entry, relocation-by-
   relocation, mutating `sourcePath` in place. After a prefix relocation
   rewrites an entry to its parent-moved location, a later `exact` relocation
   keyed on the original pre-move path no longer matches it. A filename rename
   inside a moved directory (`main.ts` -> `mcp-stdio.ts` under a new parent)
   hits exactly this: the destination must be computed from the entry's
   **original** `sourcePath`, not from the already-rewritten intermediate one.

The write-lock scope is not the problem: each `applySourceRename` call mutates
and flushes inside one `withProjectWriteLock` session. The intermediate states
become durable because bulk moves arrive as *many lock sessions*, each
legitimately persisting its own partial view.

## Design direction

Fix the rewrite, not the keying. One rename event should produce a **closed
relocation set** and apply it **as a batch computed against pre-batch state**:

1. **Close the folder gap**: when the rename target is a directory, emit the
   prefix relocation for descendants *plus* an `exact` relocation for the
   folder node itself (`fromSourcePath` = folder, `toSourcePath` = new folder).
   Same for the inferred parent relocation when the parent is a directory.
2. **Batch semantics in `applyRegistrySourceRelocations`**: compute each
   entry's final destination from its original `sourcePath` by choosing the
   **most specific match** across the whole relocation set (exact beats prefix;
   longer prefix beats shorter), instead of folding sequential rewrites through
   intermediate states. This makes the result independent of event arrival
   order and immune to exact-after-prefix interference.
3. Keys, reconcile, and the revision-mismatch recovery path
   (`RegistryRevisionMismatchError` handling in `applySourceRename`) stay as
   they are — they already follow the documented model.

Non-goals (carried from the issue): no write-lock redesign, no registry schema
change, no concurrency change beyond making each event's rewrite set closed.

## Test plan (in `projectRename.test.ts`)

- Directory rename: the folder record's own `sourcePath` moves with it
  (defect 2).
- Filename rename inside a moved directory, applied after the parent prefix
  has already landed: final `sourcePath` is the renamed file under the new
  parent (defect 1).
- Folder collapse whose children move to a differently-named parent.
- Order independence: the same two relocations applied in either order yield
  identical registry content.
- Misplaced-cognition entry inside a moved folder: `sourcePath` rewrites, key
  unchanged.

## Open items found while analyzing (report-only, not fixed here)

- `registry/sourceRelocation.ts` imports `sourcePathToKey` without using it —
  dead import, possibly a leftover from an earlier re-key attempt.
