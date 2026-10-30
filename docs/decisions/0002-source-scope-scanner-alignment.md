---
description: Source-tree scope is declaration-driven — the bridge mounts the pathscope scanner alignment face, nested repositories descend at any depth (report-not-cut), and the stoneHit report becomes per-stone names
---

# Decision 0002: Source Scope Declares Itself — the Scanner Alignment Face

- Status: accepted
- Date: 2026-10-30
- Scope: `@coggit/core` `createSourceExclusion` (the single exclusion bridge
  behind snapshot tree, path-ignore walks, folder fingerprints, discovery
  scans), its test suite, the cognition mirror

## Context

Decision 0001 mounted the pathscope engine with its default git-family
semantics: a nested `.git` truncates the subtree whole. The flagship
deployment (the meta repo that dogfoods coggit) keeps its delivery code in a
*registered submodule* under the declared source root — the stone cut the
whole delivery tree out of every scan, per-path status went blind for every
registry pair, and the regression went unnoticed for six days (meta ISSUE,
2026-10-30). The cause is a model mismatch, not a bug: coggit's scope is
declaration-driven (the source-root declaration defines the universe; truth
is the working tree in any state), while the core stone answers git's
question — "is this another repository's territory?" — a question coggit
never asks. Evidence assembled with pathscope the same day: the scanner
mainstream (rg/fd, the ignore-crate family pathscope's API face benchmarks)
does not truncate at nested repositories and treats a nested `.gitignore`
as rules; git itself descends into *registered* submodules.

## Decision

1. `createSourceExclusion` mounts `alignment: 'scanner'` (pathscope
   2026-10-30 owner ruling, `c4dec11` + contract sharpening `92fa14a`):
   nested repositories descend at any depth — the depth the
   `boundaryStones.exempt` self-match key cannot express — a `.git` hit is
   report-not-cut, and a nested `.gitignore` is rules, not territory. The
   source-root declaration IS the registration (declaration-as-registration);
   no config key, no per-subtree registration tax on any deployment.
2. The bridge reports per-stone hit NAMES, never a boolean. The engine
   contract truncates unconditionally on the boolean form under every face;
   the array form is what suspends the core-stone cut — the rewritten
   nested-repo test pins this discipline from the consumer side (a bridge
   regression to boolean turns it red) exactly as pathscope's contract text
   pins it from the engine side.
3. `.git` entries keep their `vcs`-preset name exclusion; a gitdir pointer
   *file* is admitted like any dotfile (the retired engine's behavior).

## Consequences

- Nested repositories inside a declared source root are indexable source;
  unwanted vendored trees are excluded by the policy channel (gitignore /
  `files.exclude`), not by repository topology. Noise exposure returns to
  the pre-0001 state by design.
- The per-stone hit names are available as nested-repo metadata for a future
  diagnostics surface (report-not-cut consumption); surfacing them in
  snapshot output is deliberately out of scope (agent-visible face, needs a
  release-acceptance packet).
- Supply: consumes `@catheadowl/pathscope` `alignment` (post-0.1.0, `link:`
  window, dist rebuilt 2026-10-30); rides the same link until the registry
  pin train (PKG-11).
- Amends decision 0001's core-stone sentence; everything else in 0001
  stands.
