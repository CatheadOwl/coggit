---
description: Source-tree exclusion swaps to the shared pathscope engine — the hardcoded name list unmounts into mounted presets with a named-negation escape hatch, the nested-.git boundary stone truncates vendored repositories, and the files.exclude merge rides the policy face
---

# Decision 0001: Source Exclusion Rides the pathscope Engine

- Status: accepted
- Date: 2026-10-24
- Amended by: [0002 — the scanner alignment face](0002-source-scope-scanner-alignment.md)
  suspends the nested-.git truncation (2026-10-30); everything else here stands
- Scope: `@coggit/core` traversal (snapshot tree, path-ignore walks, folder
  fingerprints, discovery scans), `@coggit/runtime-node` config discovery,
  the VS Code adapter's `files.exclude` merge

## Context

coggit's exclusion was two self-written engines: a `.gitignore` matcher
(`gitignore.ts`) and a hardcoded 23-entry generated-directory list
(`sourceStructureIgnore.ts`). The list collided with mainstream source
layouts (`lib`, `vendor`, `build`, `dist`, `out`, `coverage`) with zero
escape hatch — a project whose source lives in `lib/` was silently
unindexable, and the VS Code `files.exclude` merge only ever ADDED excludes
(`enabled === true` only), never removed them. Requirement archaeology
(2026-10-24, the P0 exclusion-semantics ticket): the layer order (structure list before
gitignore) was born uncommented and unadjudicated; the colliding entries
were added by a perf commit without discussion; the cognition mirror's
"even when a project forgot to list them" rationale was written after the
fact. Meanwhile pathscope (`@catheadowl/pathscope` 0.1.0) had just
extracted the shared file-scope engine this semantics belongs to, with the
mainstream precedence canon verified against ripgrep's ignore crate
(override whitelist highest, no immune lists in the search/index domain).

## Decision

1. **Engine swap.** The two engines retire; every traversal point
   adjudicates through pathscope's composable decision core
   (`createExclusionEngine`) behind `createSourceExclusion`, which runs the
   engine's construction-time inherited phase and per-directory probes over
   coggit's async `FileSystem`. Supply is a registry dependency on
   `@catheadowl/pathscope` `^0.1.1` (0.1.1 published 2026-10-31; the
   closing train closed the `link:` transition window, which rode the
   local checkout as a pnpm junction). The published bundle inlines the
   engine's CJS face.
2. **List unmounts into mounted presets.** coggit mounts `vcs` / `deps` /
   `build` / `caches`. Cache trees (the uncontentious subset of the old
   list) ride `caches`; colliding build/deps names ride `build`/`deps` and
   are un-excludable by a named gitignore negation (`!lib/`) — the
   zero-escape-hatch bug is fixed by that hatch, not by flipping defaults.
   A/B proof: HEAD 8e1d8fb misses `lib/`+`vendor/` source despite the
   negation (the name list outranked gitignore); the swap indexes them.
3. **`.git` handling returns to its canon.** A directory *containing*
   `.git` (file or directory form — submodules, worktrees, vendored
   repositories) is the engine's core boundary stone: the subtree truncates
   whole, as git treats embedded repositories. A directory merely *named*
   `.git` stays covered by the `vcs` preset. The old name-list treatment of
   `.git` retires.
4. **Unchanged axes.** Dot entries remain indexable (`excludeDotEntries:
   false` — the retired engine's behavior; `.gitignore` files themselves
   and `.github/` are ordinary source). gitignore rules above the source
   root now inherit down from the enclosing git root (git-native; the old
   engine anchored at the project root).
5. **`files.exclude` merge rides the policy face.** The VS Code adapter
   maps `enabled === true` entries to exclude patterns; the built-in floor
   is the engine's mounted presets. The old "add-only, never un-exclude"
   limitation dissolves — un-excluding a coggit default is a gitignore
   negation, not a `files.exclude` switch.
6. **Known absorbed deviation.** The retired matcher treated unanchored
   patterns containing a separator as suffix matches at any depth
   (`findMatchingSuffix`); git anchors them to the rule base. The swap
   retires the deviation (pathscope fixture 17 pins git's truth; fixture 32
   absorbs the layering corpus).

## Regression gate (three real trees, snapshot face, old vs new)

| tree | shape | result |
| --- | --- | --- |
| a workspace vendoring this repo | vendored nested repo (`.git` file form) inside the source root | 369 → 25 files: the vendored subtree (344 files) truncates via the core stone; a sibling plain-copy directory (no `.git`) stays indexed by both engines |
| two unrelated regular trees | regular trees | byte-identical counts, zero diff |
| constructed lib/vendor workspace | bug-fix proof | old misses `lib/engine.ts` + `vendor/adapter.ts` despite `!lib/`/`!vendor/`; new indexes both |

The vendored-repo truncation matches the accepted earlier vendored-repo
precedents — vendored repositories are foreign territory. A workspace whose
cognition mirror covers the truncated subtree loses the source pairing for
those paths; pointing the tool at the nested repository as its own workspace
(it is its own repository) is the mitigation.

## Consequences

- Install closure of `@coggit/core` grows to `@catheadowl/pathscope` and
  its transitive `ignore` / `fdir` / `find-up` (all zero install scripts,
  verified 2026-10-24). The published bundle inlines them (esbuild); the
  runtime install set resolves from the registry (pathscope 0.1.1).
- `verify:publish-face` (the PKG-11 `link:` guard) is
  green again with the registry pin (`^0.1.1`).
- Case absorption: the retired matcher's corpus diffed against the pathscope
  fixtures produced fixture 32 (two-level nested rule base, git-oracle);
  everything else was already covered (01/09/11/14/15/17).
- Orphaned cognition: registry entries under a truncated vendored subtree
  surface as orphans (source missing) — the maintenance view is the
  honest signal, not a bug.

## Reversal conditions

- A real workspace needs vendored-repo CONTENT in the root view and the
  drill-down route (scan the nested repo as its own workspace) does not
  fit — escalate to the pathscope seam (an opt-out key would be a
  registered extension there), do not fork the semantics locally.
- The gitignore inheritance above the source root misfires on a real
  workspace (an outer repo's rules wrongly hiding project source) with no
  git-native remedy — same escalation path (engine-side hatch), not a
  local re-anchoring.

## Reversal-condition note (2026-10-24)

The engine-side exemption hatch landed: pathscope `boundaryStones.exempt`
(named-subtree core-stone exemption, registered fixture 33). For coggit
specifically: this consumer drives `createExclusionEngine` with its own
traversal, so an exemption adjudication requires the third `excludeDirectory`
argument to report per-stone hit names in the array form
(`stoneHit: readonly string[]`) — the boolean form opts out of exemption
adjudication entirely. Whether the coggit submodule and the orphaned
cognition group get registered is this decision's reversal call.
