# Design Intent and Existing Docs

CogGit looks like a documentation layer at first glance, so the natural question is how it relates to ADRs, PRDs, comments, and source code.

The short answer: CogGit does not try to become the source of truth for every decision. It records the local consequences of decisions at the file and folder level, then keeps those local records fresh as the implementation changes.

## The Layers

Most mature projects already have several kinds of truth:

```text
Global decisions   -> ADRs, PRDs, design docs
Local design       -> CogGit cognition files
Running behavior   -> source code and tests
```

ADRs and PRDs explain the direction of the project. Source code and tests define what actually runs. Cognition files sit between them: they explain what the broader decisions mean here, for this module, with these boundaries and neighboring constraints.

## Why ADRs Are Not Enough For Agents

An agent can read ADRs directly, but that does not mean it can reliably infer the right local constraint for a specific file.

The costly step is not reading one design document. The costly step is repeatedly deciding which design documents matter, how they interact, and what they imply for the exact code being changed. In a large project, that reconstruction work is easy to miss, overfit, or forget as the context window shifts.

CogGit makes that local interpretation durable. A cognition file can reference a broader ADR without copying it, then record what that ADR means for the nearby implementation boundary.

## Why Comments Are Not Enough

Code comments usually explain nearby mechanics: an edge case, a non-obvious line, or a small implementation decision.

Cognition files explain a wider design surface:

- the responsibility of a file or folder
- contracts it exposes to neighbors
- invariants that should survive refactors
- reasons a tempting alternative is intentionally avoided
- what should be reviewed when the source changes

That information can be too broad for inline comments and too local for a global ADR.

## How CogGit Reduces Agent Drift

Agent drift often happens when local constraints must be rebuilt from scattered evidence on every task. The agent may read the source, find a related document, infer a plausible rule, and still miss the specific boundary that previous work established.

CogGit gives the agent a source-shaped route into design context. The route map helps locate the relevant cognition document, and freshness status tells the agent whether that document is still aligned with the source. The agent still reads source and tests when needed, but it starts with a maintained local model instead of reconstructing one from scratch.

## What Belongs In Cognition

Good cognition content is local, current, and operational:

- purpose and responsibility of the paired source node
- module contracts and boundary rules
- local consequences of ADRs, PRDs, or design decisions
- constraints that should guide future changes
- change strategy and review cues

## What Does Not Belong In Cognition

Cognition files should not become a second wiki or a copy of every design document.

Avoid storing:

- full ADR or PRD copies
- broad product strategy
- historical debate that no longer guides changes
- generic knowledge base material
- implementation summaries that merely restate the code

If a broader document is the authoritative place for a decision, link to it. Use cognition to record how that decision lands in the local implementation.
