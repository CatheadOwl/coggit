---
description: Rule sources are admitted by intent domain — coggit's scope answers git's question, so the search-domain ignore family (.ignore/.rgignore) is pinned off explicitly in the shared engine options, and any family opt-in, if it ever comes, is a new decision rather than a default ride
---

# Decision 0004: Rule Sources Are Admitted by Intent Domain

- Status: accepted
- Date: 2026-11-21
- Scope: the shared engine options block (`COGGIT_ENGINE_OPTIONS` in
  `packages/core/src/sourceExclusion.ts`) every coggit adjudication face
  mounts, and the escape-channel framing this decision retires in
  [0001](0001-source-exclusion-pathscope-engine.md)

## Context

The engine bump absorbed here (0.2.0 → 0.4.3) carries the ignore family:
`.ignore` / `.rgignore` folded into the gitignore cascade with ripgrep's own
precedence, `respectIgnoreFamily` defaulting to true — the scanner domain's
own canon (rg WalkBuilder parity). The bump therefore forces the consumer
call the engine's changelog explicitly leaves to riders: ride the default,
or pin the family off. The owner framed the call as architecture, not
compatibility: decide which rule sources govern coggit's scope, then express
the answer through the engine's own seam.

## Decision

Rule sources are admitted by intent domain. coggit's scope answers git's
question — "what is this project" — so git-domain declarations (the
`.gitignore` cascade) govern it, and search-domain declarations (`.ignore` /
`.rgignore`, the rg lineage) do not. `respectIgnoreFamily: false` is pinned
in `COGGIT_ENGINE_OPTIONS`, the same composition-declaration status as
`excludeDotEntries: false` and `alignment: 'scanner'` — an explicit stance,
not a compatibility default.

Adjudication grounds:

1. "Any author-written ignore file governs" is not a drawable line —
   `.eslintignore`, `.dockerignore`, `.npmignore` follow immediately, and an
   unbounded set cannot rule. The only drawable line is the intent domain a
   declaration answers.
2. The git-native alignment skeleton and the tracked-shape direction
   ([0003](0003-structural-signal-tracked-shape.md)) already run on this
   axis: coggit's scope derives from git's own word about the project.
3. Precedent splits on exactly this line, and coggit sits on the indexer
   side: VS Code's Copilot semantic index honors `.gitignore` +
   `files.exclude`, Zed's project scan honors `.gitignore` + its own scan
   exclusions — while family-honoring defaults belong to search tools
   (ripgrep, VS Code search). coggit is an indexer.
4. No conflict with the engine's default-true: the engine answers the
   scanner question, and a consumer composing its scope by its own domain is
   the designed use of the seam. Two domains, two questions, each canonical
   at home.

## Consequences

- The ignore family changes nothing on any coggit face — walk and probe
  alike. The probe/walk parity risk contingent on riding the family
  (coggit's walk IO implements `readGitignore` only while the point-query
  probe replays through the engine's default filesystem reader, so a
  family-on walk would diverge from its own diagnostics) dissolves before
  it exists.
- The same bump retires 0001's named-negation-as-design framing (marked in
  its amended-by line): pathscope adr-0005 (2026-11-21) ruled a
  consumer-written negation a patch over a wrong default and moved the
  rescue into the engine's default table (`src/lib` rides its own natural
  exemption; root `lib/` stays excluded behind a registered re-adjudication
  trigger). The negation itself still works as git-native escape.
- Pin `^0.4.3`: the first plain-npm-safe release — 0.4.0 through 0.4.2
  carry the registry-metadata gypfile defect that hard-fails plain
  `npm install` (found by the engine-side release train 2026-11-21, fixed
  by 0.4.3's `gypfile: false`); the consumer's joint debugging rode the
  junction form and so could not see that lane.
- If a real indexing need ever asks to admit search-domain declarations,
  that is a new decision with its own user-facing seat — never a default
  flip.
