# Eval rubric — answer key

This is the **grading standard** for the judge runs. The judge (`prompt.md`) never sees this file; it sees only the tool descriptions + projected outputs. You, the human, compare each judge's three parts against this key.

The eval measures **semantic comprehension only** — "can a fresh model read the projected output and know what to do next". Field *presence/shape* is already locked deterministically by `test/shape-and-views.test.mjs`; do not re-grade it here.

## Per-field key (expected understanding)

| Field | Expected understanding |
|---|---|
| `sourcePath` | Source-root-relative path of the node. On hit/success it is the canonical resolved path; on miss/failure it echoes the (possibly wrong) input. |
| `cognitionPath` | The paired cognition doc path. Present on hit + add/resolve success; absent on miss/failure. In the `status: null` case it is a *target* path, not proof the file exists. |
| `found` | Appears **only** as `false` on a miss. A hit omits the key (matched = shape, not a `found: true`). |
| `pathHints` | Fuzzy candidate source-root-relative paths; present only on a miss/failure with candidates. |
| `status` | Whole-node observed status: `fresh` / `stale` / `null`. `null` = source exists but has no paired cognition yet — the materialization-branch precondition, **not an issue**. On a folder it aggregates the worst of own + descendants. |
| `cognitionPresence` | Whether paired cognition exists for the node: `present` / `missing` / `not-applicable`. `missing` + `status: null` is the "add on demand" signal. |
| `ownIssueCount` / `descendantIssueCount` | Two-level issue split: "my problems" vs "problems in my subtree". Present even when `0`. |
| `ownIssues` / `descendantIssues` | Log-style issue rows, each `{ sourcePath, level, issueTags, actionTags, optionalActionTags }`: the node's severity level (`INFO`/`WARN`/`ERROR`), its issue tags, and its recommended vs optional action tags. |
| `issueLegend` | Defines each issue tag once: `{ level, tag, description, hints }`. |
| `actionLegend` | Defines each action tag once: `{ tag, role, description }`, where `role` is `recommended` or `optional-on-demand`. |
| `success` | Boolean outcome of add/resolve only (status uses `found`/`status` instead). |
| `created` | Whether add actually wrote a new doc (`false` = already exists, not a failure). |
| `kind` | Resolved cognition kind (`leaf`/`skeleton`) on add success. |
| `error` | `{ code, message }` on add/resolve failure. The only place `code` appears in the projection. |
| `surfaceHints` | Imperative next-step strings (tool calls / skill loads / path retries). Present on every output, possibly `[]`; carries the *current node's* steps (descendant steps live in the descendant rows' action tags). |

## Per-scenario expected next action

| Scenario | The agent should … |
|---|---|
| status-hit-fresh | Do nothing to fix; load the handbook skill only if about to author/edit this cognition. |
| status-hit-stale | Load skill → sync the cognition to the source → `coggit_resolve` (resolve itself confirms fresh). |
| status-hit-null | `coggit_add` for that path, then load the named skill to complete the created template. |
| status-hit-folder | Load the skeleton skill → sync the folder README and any stale descendants → `coggit_resolve`. |
| status-hit-folder-mixed | The folder's own README is fresh (no own row, `ownIssueCount: 0`), so do NOT `coggit_resolve` the folder — sync the stale descendant (`coggit/src/views.ts`) only, routed via its `descendantIssues` row's `actionTags` (`sync-leaf`, `resolve`). The whole-node `status: stale` comes from the descendant, not the folder itself. |
| status-miss-candidates | Retry with a `pathHints` candidate. |
| status-miss-nocandidates | Stop; the path is wrong or outside any project (use root view / ask the user). |
| add-success | Load the named skill and complete the template (the returned `cognitionPath` is the proof of the write). |
| add-already-exists | Do not rewrite; `created: false` means the doc already exists — load the skill only if editing. |
| add-success-skeleton | Load the skeleton skill and complete the folder README template. |
| add-miss-candidates | Retry `coggit_add` with a `pathHints` candidate. |
| add-error-invalid-kind | Read `error`; retry with the matching kind (leaf for files, skeleton for folders). |
| resolve-success | Nothing further — success is already the confirmation of fresh (`surfaceHints: []`). |
| resolve-miss-candidates | Retry `coggit_resolve` with a `pathHints` candidate. |
| resolve-error-content-changed | Re-inspect the source + cognition, re-sync, then retry `coggit_resolve`. |

## Known intentional design — do NOT count these as errors

A judge "red flag" is only a real finding if it is NOT one of the deliberate choices below. If a judge flags only these, the output is understood correctly.

1. **`found` is one-sided** — only ever `false`; a hit is signalled by the *presence* of `status`/`cognitionPath`, not by `found: true`. Deliberate: an always-true discriminator is pure token waste.
2. **`pathHints` and `surfaceHints` restate the same candidates** — one structured list + one prose line. Deliberate: the model gets both a clean list to copy and a sentence to read.
3. **`code` appears only in `error.code` (operation failures)** — the status projection carries no machine-readable diagnostic code at all: issues are tag-based (`issueTags`), and the actionable workflow signal rides the action tags (`operation`/`handbookId` semantics) plus the adapter's `surfaceHints` addressing. So a judge must not expect an issue-level `code` field.
4. **Own vs descendant is carried by counts + row placement, not per-node status fields** — there is no `ownStatus`/`descendantStatus` in the projection (the upstream canonical `statusAgentPresentation` drops them, matching the CLI text, which shows only the aggregated `Status`). The split lives in `ownIssueCount` vs `descendantIssueCount` and which array a row lands in.
5. **Missing cognition is NOT an issue — it is the materialization branch** (upstream ADR 0015). An uncognized node reports `status: null` + `cognitionPresence: "missing"` with **empty** `ownIssues`/`issueLegend` (the `missing-cognition` issue only exists under core's `issueVisibility: 'all'`, which this adapter does not use) and the `create-cognition` add action in `surfaceHints`. A judge must read "missing + add" as the on-demand branch, not as a defect.
6. **`cognitionPath` present while the file is missing** (status-hit-null) — it is the *intended* location, not proof of existence.
7. **The re-check is a `suggestedAction`, not a separate `verify` field** —non-miss add/resolve failures carry one `suggestedActions[]` entry with `operation: 'status'` (`Call coggit_status with sourcePath="…".`) so the model re-inspects current state. Success branches carry none: add's returned `cognitionPath` proves the write, resolve re-records the pair (fresh), so a trailing re-check would be redundant.
8. **`stale` carries two signals in one ordered plan — the handbook-sync step leads, the resolve step trails** — two steps, not a contradiction. Core emits the ordered pair `sync-cognition-with-source` (a `handbookId`-bearing authoring step) then `resolve-stale-cognition` (`operation: 'resolve'`); the row's `actionTags` keep that order (`sync-leaf`, `resolve`), the `actionLegend` defines each tag once, and the adapter's `surfaceHints` render the own-node steps as the leading handbook-skill hint plus `Call coggit_resolve with sourcePath="…".`. The model must sync (or confirm the cognition already covers the source) before resolving — the resolve tool's own description ("after … confirming the cognition correctly covers the source") is the gate. A stale pair whose own node is fresh never gets a top-level resolve (see #16).
9. **Row `level` is core's severity semantics, passed through unchanged** —`WARN` for `outdated-cognition`, `INFO` for `missing-cognition` (when it appears under `all` visibility). Severity ranks *risk of acting on misleading info*, not "brokenness": missing is the normal not-yet-created state; stale means an existing cognition has drifted.
10. **`pathHints` can be fuzzy name matches, not just prefix repairs** (`src/nope.ts` → `coggit/src/note.ts`) — deliberate recall-maximizing candidates from core. The agent must verify the candidate is the intended file before retrying.
11. **Empty-vs-omitted is per-field, not uniform** — `surfaceHints` is always present (possibly `[]`) because it is the stable "next step" slot; `pathHints` /`found`/`error` are omitted when empty to keep the payload minimal (see #1).
12. **`surfaceHints` restate the own-node structured actions in copy-pasteable form** — "Call `coggit_resolve` with `sourcePath=…`" duplicates the action + path. Deliberate: the model gets a concrete invocation, while the rows carry the shared tag semantics ("keep your own surface addresses", upstream ADR 0015 / the compact action-tag FR).
13. **`resolve-error-content-changed` echoes the canonical node path** — core resolves the node before the acceptance guard runs, so a post-resolution failure (content changed mid-operation) reports the canonical path, matching `addOperation`'s canonical-on-found split (core `1b1b9db`). The re-check hint then re-diagnoses via `coggit_status`, which canonicalizes.
14. **The handbook hint says "this cognition" even when none exists yet (`status-hit-null`)** — "authoring or editing" covers the create-then-complete flow; the hint is a standing precondition, not an assertion that a doc exists.
15. **A folder can be `stale` while its own README is `fresh`** — whole-node `status` aggregates the worst of own + descendant (`fresh` < `stale` < `conflict`), so one stale descendant marks the folder `stale`. That is `status-hit-folder-mixed`: no own row (`ownIssueCount: 0`), one descendant row driving the aggregated `status: stale`.
16. **Descendant next steps live in the descendant rows' action tags, never in the top-level `surfaceHints`** — core keeps the top-level `suggestedActions` channel own-node-only and dedupes descendant actions into the triage channel (core `6620c1f`+), which `statusAgentPresentation` renders as the descendant rows' `actionTags` defined once in `actionLegend` — matching the CLI/MCP text surface. So `status-hit-folder-mixed` carries **no top-level resolve hint** (the folder's own README is fresh); the stale descendant's sync+resolve pair appears in its `descendantIssues` row. A judge must route the descendant's next step from that row, not from the top-level `surfaceHints`.

## How to grade a run

1. Read the judge's Part 1 and check the per-field key above. A field is "understood" if the judge's meaning matches, even in different wording.
2. Read Part 2 and check the per-scenario table. The judge must correctly distinguish `cognitionPresence: 'missing'` with the add hint (materialization branch) from `found: false` (retry path) and must reach `resolve` on stale.
3. Read Part 3. A red flag is a **real finding only** if it is not in the known-intentional list above. Real findings are actionable design gaps.
4. Across N runs, aggregate: fields/actions all runs agree on = converged; disagreements or real (non-listed) red flags = investigate.
