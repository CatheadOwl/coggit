---
description: Folder skeleton structural signal observes the git-tracked shape — untracked-and-not-gitignored entries stop flipping skeleton pairs stale; hosts without a git index fall back to counting every on-disk entry
---

# Decision 0003: The Structural Signal Observes the Tracked Shape

- Status: accepted
- Date: 2026-11-21
- Scope: `@coggit/core` snapshot tree folder fingerprints and the folder
  source-fact derivations that must stay in the same domain
  (`captureReviewedPair`, `readDirectFolderFingerprint`), the
  `TrackedEntriesIndex` service seam, the Node git-backed implementation,
  host service assemblies, and the structural-freshness spec/concept faces
  on the meta side

## Context

A folder/root skeleton's source fact is the directory-entry fingerprint of
its direct children. The walk excludes gitignored entries and preset trees,
but never consults the git index — so a directory that is untracked and not
gitignored (the scratch tree every agent workspace grows: local scripts,
playgrounds, empty scaffolding) joins the fingerprint, its acceptance no
longer matches, and every ancestor skeleton pair flips stale. Reported
against this repository's own meta deployment (2026-11-21): an empty
`codebase/scripts/` — a shape git cannot even represent — staled the root
skeleton, and the scratch lifecycle (create during a session, clean up
after) re-triggered the stale → sync → resolve loop on every toggle.

Two independent consequences, one cause:

1. **Repeated false staleness.** Scratch churn flips accepted skeleton
   pairs stale, and the recommended repair (sync + resolve) bakes the
   scratch entry into the accepted fingerprint, so the later cleanup stales
   the pair again. The signal trains users to ignore it.
2. **Fresh clones never start fresh.** The structural-freshness spec
   requires cross-device reproducibility, but a fresh clone lacks untracked
   entries by definition — the first status after every clone mismatches the
   accepted fingerprint recorded on the authoring machine.

The concept layer already carries the governing rationale: the structural
fingerprint excludes gitignored entries because "ignored files are not part
of the tracked directory shape". The untracked case is the same question —
an entry git does not track is not part of the tracked shape either — and
answering it differently has no principled basis.

## Decision

1. **The folder structural signal observes the tracked shape.** Snapshot
   tree builds fingerprint only tracked children when a
   `TrackedEntriesIndex` service can answer; untracked-and-not-gitignored
   entries stop participating in skeleton freshness. Untracked nodes remain
   in the node tree exactly as before (snapshot rows, coverage, add flows)
   — only the folder's own source fact narrows.
2. **One seam, optional service, three domains.** `CoggitServices.trackedEntries?`
   (new `TrackedEntriesIndex` port in core interfaces) with a single method —
   `trackedChildNames(directoryUri)` returning a `TrackedShapeDomain`:
   `{kind:'git', names}` (tracked direct children; fingerprint only those),
   `{kind:'non-git'}` (no index governs this tree — the stable
   include-all fallback semantics, acceptance flows unchanged), or
   `{kind:'unavailable'}` (a git index governs the tree but cannot be read
   right now). An `unavailable` answer keeps the fallback children for
   display but **holds acceptance writes** for that folder's own pair:
   bootstrap, cognition-only and ordered auto-acceptance are skipped, and
   resolve fails with the typed `tracked-shape-unavailable` code — a
   transient blind spot must not persist a fingerprint from the wrong
   domain. Failures are never cached; the next query retries. Node hosts
   get a git-backed implementation (`createGitTrackedEntriesIndex`):
   upward `.git` probe per query resolves the owning repository (gitlink
   worktrees included, `.git` file or directory), one
   `git ls-files --full-name -z` per repository bucketed by directory,
   cached listing bound to the index git actually reads — resolved once per
   repository with `git rev-parse --path-format=absolute --git-path index`
   (worktrees and gitfiles resolve through their real git dir; inherited
   path-override variables GIT_INDEX_FILE / GIT_DIR / GIT_WORK_TREE are
   stripped, so the repository's own default index is always the
   authoritative shape — an alternate-index mode would be an explicit
   follow-up design) — and stamped with that file's mtime+size, accepted
   only when the stamps read before and after `ls-files` agree. The
   `ls-files` read itself is pinned to the resolved binding (GIT_INDEX_FILE
   set to the resolved path in the child environment — chosen by the
   service, not inherited), so a gitfile retarget mid-read cannot
   substitute another index's output. The index path cache is invalidated
   when the `.git` entry's own stamp changes (gitfile retargeting). CLI, MCP, dsh (via `createNodeCoggitServices`) and
   the VS Code model wire it; hosts with virtual filesystems may omit the
   service.
3. **Every folder-fingerprint derivation rides the same domain.** A resolve
   must accept the same fingerprint identity a status read compares —
   `captureReviewedPair` narrows its fingerprint through the index, and the
   watch pipeline's `readDirectFolderFingerprint` (directory-entry change
   events, passive cognition acceptance) does too. A create/delete event
   for an untracked path no longer advances a folder source fact.
4. **Non-git hosts keep today's semantics.** The declaration-driven scope
   principle stands: the source-root declaration defines the universe, and
   the structural signal stays meaningful without git. Fallback is a
   degradation, not a second truth.
5. **The fingerprint domain change is accepted as a one-time re-judge.**
   Pairs whose accepted fingerprints included untracked entries read as
   stale on the first read after upgrade; each then heals through the
   normal sync + resolve flow (a human/agent re-confirmation writing the
   new baseline — not an automatic self-heal). No legacy-data migration.

## Consequences

- Scratch toggling no longer flips skeleton pairs stale on git-backed
  hosts; the stale → sync → resolve loop fires only for genuine tracked
  structure change (add/remove/rename of tracked entries, including
  staging-only changes — the index, not the commit, is the shape).
- Fresh clones reproduce the accepted fingerprints when the effective
  tracked shape, the exclusion rules, and the accepted baseline match
  the authoring machine; the first status after such a clone is fresh
  for unchanged structure. The index-binding bullet below qualifies the
  boundary (staged-only shape is outside the guarantee).
- Git absence and a failing git read are different domains, not one
  silent degradation: `non-git` (no git index governs the tree) is the
  stable include-all semantics by design — no marker; `unavailable` (an
  index governs the tree but cannot be read right now) degrades display
  and is never silent — see the `tracked-shape-unverified` bullet
  below.
- Test fixtures and workspaces without a git repository exercise the
  fallback; agent-surface eval fixtures are unaffected by construction.
- Folder pairs do not participate in ordered auto-acceptance: a watcher
  notification cannot prove that the re-read tracked shape preceded the
  cognition edit it is paired against, so directory-entry evidence never
  enables ordered acceptance and a folder pair whose tracked shape
  changed heals through explicit resolve (cognition-only changes still
  re-accept — that path needs no ordering evidence). Leaf facts keep
  ordered auto-acceptance — their
  watcher events carry direct causality for the file they name — guarded
  by a leaf consumption watermark: a leaf observation whose arrival
  generation is at or below the acceptance that consumed the key's record
  is refused (a suspended read cannot fabricate ordering against the
  consuming cognition). A trusted structure-change correlation would be
  required to restore folder ordered acceptance; until then this is by
  design, not a gap.
- Index-only changes (pure `git add`/`git rm --cached` with no on-disk
  entry change) surface on the next read, not through the watcher: the
  watch targets do not subscribe to git's index file, and doing so would
  couple refresh storms to every git operation. Registered follow-up.
- The stat-based stamp is a heuristic: a same-mtime same-size index swap
  can evade invalidation until the next real stamp change. The
  before/after stamp agreement during loads closes the mid-read swap; it
  does not promise collision-freedom.
- Display while `unavailable` rides the pre-v5 mtime heuristic with an
  info diagnostic `tracked-shape-unverified` attached to the pair; a
  first-class degraded marker on the status surface is a registered
  follow-up (filed on the meta side).
- The accepted fingerprint binds to the working INDEX — staged-but-
  uncommitted entries are part of the accepted shape. A fresh clone of
  the same commit without that staged state re-judges stale and re-binds
  through resolve. The cross-device guarantee therefore holds for the
  same effective tracked shape + exclusions + accepted baseline, not for
  arbitrary commit clones.
- Docs: the structural-freshness spec and the folder-structural-fingerprint
  concept pages carry the tracked-shape ruling and the fresh-clone
  acceptance criterion.

## Regression gate

| Scenario | Before | After |
|---|---|---|
| Untracked scratch dir toggled, index answers | skeleton stale on every toggle | fresh throughout |
| Tracked entry added/removed (index or staging) | stale | stale (unchanged) |
| Fresh clone of a repo with accepted skeletons | first status stale | fresh |
| Workspace without git | stale on scratch churn | stale on scratch churn (fallback preserved) |
| Resolve on a folder pair | accepts raw-children fingerprint | accepts tracked-shape fingerprint (same domain as status) |
