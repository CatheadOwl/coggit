# Skeleton Maintenance Handbook

## Role

A skeleton is the stable cognition file for a directory or layer.

It is the local constitution: identity, contract, invariants, and principles
that should remain true while implementation changes.

## Scope

A skeleton belongs to folder- or layer-level truth:

- Identity of the folder or layer
- Ownership boundary and dependency rules
- Layer-level invariants and stable principles
- Pointers to lower-volatility documents

Keep less stable knowledge elsewhere: current file inventory belongs in
`MODULES.md`; runtime wiring or activation flow belongs in `CODE_MAP.md`;
source-file design cognition belongs in a leaf; historical notes belong in
`KNOWLEDGE.md`.

## Design Source Rule

When the agent is already working from an external single source of truth
(SSOT) that governs the folder or layer, keep the skeleton as its local
projection.

Reference the source from `## Pointers`, or inline it under the invariant it
constrains. Do not summarize the source.

If a layer-wide collision appears, record the local resolution under the
relevant invariant.

## Update Rules

Update the skeleton when the folder's layer-level meaning changes:

- The layer identity changes.
- The layer contract changes.
- A new layer-level invariant is discovered.
- A stable principle should be added or removed.
- A layer-wide design source collision is discovered or resolved. Record it as an
  inline note under the relevant invariant:
  ```
  - **MUST** <rule> - ADR-003 and ADR-007 collide here; resolved by <one line>.
  ```

When CogGit marks a skeleton stale, inspect what changed in the folder before
deciding whether the skeleton text needs to change. If the identity, contract,
and invariants still hold, accept the review without changing the skeleton text.

Do not update the skeleton merely to mirror implementation shape.

## Anti-Bloat Rule

A skeleton may repeat a rule that code already hints at when the rule is a
contract. Its value is enforcement and orientation, not implementation summary.

Do not include current file inventory, source-level dependency lists,
function-by-function explanations, one-off implementation notes, leaf-level
design decisions, or testable behavior that belongs in fixtures or regression
tests.

The skeleton becomes bloated when it starts tracking current implementation
shape instead of stable architectural truth.
