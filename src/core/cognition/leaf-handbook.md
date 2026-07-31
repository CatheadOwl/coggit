# Leaf Maintenance Handbook

## Role

A leaf is atomic cognition for one source file.

It records the design intent, hidden contract, rejected alternative, or
non-obvious boundary that would be lost if a reader only inspected the code.

## Creation Rule

Not every source file needs a leaf.

Create one when the file has:

- A meaningful design decision
- A boundary that is easy to misread
- A hidden caller/callee contract
- A non-obvious dependency rule
- A role that is more important than its exported names

Do not create one for files whose purpose is fully explained by file name,
types, signatures, and nearby skeleton or module inventory.

## WANOC Test

Use the We-Are-Not-Our-Code test:

> If you only saw the file name and a one-line comment, would this cognition
> entry still tell you something not recoverable from signatures and code?

If the answer is no, remove the entry.

## Preferred Structure

Use this minimum shape:

```markdown
## Role

## Design Decisions
```

Add these only when they carry real cognition:

- `Boundaries`
- `Open Questions`

Avoid standalone sections for:

- `Callers`
- `Dependencies`
- `Invariants`
- `What It Does Not Do`
- `Responsibilities`

Those sections are not forbidden, but in leaf files they are common bloat
sources. Prefer folding their useful parts into design decisions or boundaries.

## Design Source & Collisions

When a design decision traces to an external design source - an ADR, RFC,
design doc, or documented verbal agreement - record the identifier and a
one-line summary inside that decision's entry. Do not create a standalone
`## References` section. If the decision is self-evident from code, omit the
source.

When multiple design sources constrain the same file and their constraints
interact or conflict, record the collision as a Note within the relevant
decision. Include: which sources, what the tension is, and how it was
resolved at this node. This is the fastest place to surface collisions -
higher-level documents cannot see them.

## Boundaries Rule

Only record a boundary when a reasonable reader might otherwise infer the wrong
ownership.

Good boundary:

- An API facade does not orchestrate multi-step workflows.

## Invariants Rule

Inline leaf-level invariants under the design decision they constrain.

## Dependency Notes Rule

Do not list source-level dependencies.

Mention a dependency only when it is design evidence: a boundary, permission,
constraint, or non-obvious choice. Otherwise, let the source speak for itself.

## Anti-Bloat Rule

A leaf should not turn into a code summary, a source-level dependency list, or a
pile of negative claims.

Keep only what adds design cognition beyond signatures and direct
implementation.

A leaf that starts approaching the source file's length is probably restating
code.

## Update Rule

Update a leaf when:

- A design decision changes.
- A hidden contract changes.
- A design-meaningful dependency note changes.
- A previous boundary becomes misleading.
- A design source already in scope changes the local implication.
- A new collision between design sources at this node is discovered.

Do not update a leaf unless the local design meaning changes.

## Design Source-Aware Update

When a cited design source is relevant to the current change, use it to check
whether the local description still holds.

Use a Source note to clarify local tension, not to start routine source
auditing.
