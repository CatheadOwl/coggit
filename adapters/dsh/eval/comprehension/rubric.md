# Eval rubric — answer key

This is the **grading standard** for the judge runs. The judge (`prompt.md`) never sees this file; it sees only the tool descriptions + projected outputs. You, the human, compare each judge's three parts against this key.

The eval measures **semantic comprehension only** — "can a fresh model read the projected output and know what to do next". Field *presence/shape* is already locked deterministically by `test/shape-and-views.test.mjs`; do not re-grade it here.

## Status output: per-line key (coggit_status returns text)

`coggit_status` delivers core's canonical agent-facing text — the same rendering the CLI and MCP deliver (FR 20260907-dsh-status-view-core-text-rendering). Expected understanding per construct:

| Construct | Expected understanding |
|---|---|
| `Status: <Fresh\|Stale\|Conflict>` | Whole-node observed status. Omitted when the node has no status yet (`null` = source exists but no paired cognition — the materialization-branch precondition, **not an issue**). On a folder it aggregates the worst of own + descendants. |
| `Source: <path>` | Source-root-relative path of the diagnosed node. |
| `Cognition: <path>` | The paired cognition doc path. `Not created (add on demand)` = no paired cognition yet — the on-demand affordance itself. |
| `Path not found in any CogGit project: <path>` (+ `Try:` line) | A miss: the path matched no node; the `Try:` line lists fuzzy candidate source-root-relative paths (backtick-wrapped). No status/issue sections exist on a miss. |
| `Legend:` block | Defines each issue tag once: `<LEVEL> <tag> <description>` plus `hint=` label-only remediation codes. |
| `Actions:` block | Defines each action tag once: `<tag> <description>` (the tags used in rows' `actions=`/`optional=` channels). |
| `Own issues: <n>` / `Descendant issues: <n>` | Two-level issue split: "my problems" vs "problems in my subtree". Present even when `0`; the rows follow each header. |
| Issue row `LEVEL \| issueTags \| source=… \| actions=… \| optional=…` | One line per issue-bearing node. `actions=` = recommended next-step tags; `optional=` = optional-on-demand tags (e.g. `add`). A descendant's next steps live in its descendant row's `actions=`, never in the trailing hints. |
| Trailing hint lines (after a blank line) | This surface's imperative next steps for the **current node only**: a `Call coggit_…` tool invocation or a handbook-skill load. Absent (no trailing block) when there is no imperative next step. |

## add/resolve output: per-field key (JSON)

| Field | Expected understanding |
|---|---|
| `sourcePath` | On success the canonical resolved path; on failure it echoes the (possibly wrong) input. |
| `cognitionPath` | The created/accepted cognition doc path; absent on failure. |
| `success` | Boolean outcome of add/resolve. |
| `created` | Whether add actually wrote a new doc (`false` = already exists, not a failure). |
| `kind` | Resolved cognition kind (`leaf`/`skeleton`) on add success. |
| `error` | `{ code, message }` on add/resolve failure. The only place `code` appears in the projection. |
| `pathHints` | Fuzzy candidate source-root-relative paths; present only on a failure with candidates. |
| `surfaceHints` | Imperative next-step strings (skill loads / path retries / re-check). Present on every add/resolve output, possibly `[]`. |

## Per-scenario expected next action

| Scenario | The agent should … |
|---|---|
| status-hit-fresh | Do nothing to fix; load the handbook skill only if about to author/edit this cognition. |
| status-hit-stale | Load skill → sync the cognition to the source → `coggit_resolve` (resolve itself confirms fresh). |
| status-hit-null | Treat `Cognition: Not created (add on demand)` as the on-demand signal: `coggit_add` for that path only if the node needs cognition, then load the named skill to complete the created template. |
| status-hit-folder | Load the skeleton skill → sync the folder README and any stale descendants → `coggit_resolve`. |
| status-hit-folder-mixed | The folder's own README is fresh (`Own issues: 0`, no own row), so do NOT `coggit_resolve` the folder — sync the stale descendant (`coggit/src/views.ts`) only, routed via its descendant row's `actions=sync-leaf,resolve`. The `Status: Stale` header comes from the descendant, not the folder itself. |
| status-miss-candidates | Retry with a `Try:` candidate. |
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

1. **Status is text, add/resolve are JSON** — the status face deliberately delivers core's canonical agent-facing text (one line per issue row; legend defines each tag once) instead of a JSON view: CLI / MCP text / dsh all deliver the same core renderer, and text is the cheaper agent-facing encoding. A judge must not expect `found`/`pathHints`/`issueLegend` fields on status.
2. **Hit vs miss is discriminated by content, not a field** — a miss opens with `Path not found…`; a hit opens with `Status:`/`Source:` headers. No `found` discriminator exists (an always-true discriminator is pure token waste).
3. **`code` appears only in `error.code` (operation failures)** — the status text carries no machine-readable diagnostic code at all: issues are tag-based, and the actionable workflow signal rides the row `actions=`/`optional=` channels plus the trailing hint lines.
4. **Own vs descendant is carried by the two count headers + row placement** — there is no `ownStatus`/`descendantStatus` in the text (the canonical agent presentation drops them, matching the CLI text, which shows only the aggregated `Status:`). The split lives in `Own issues:` vs `Descendant issues:` and which section a row lands in.
5. **Missing cognition is NOT an issue — it is the materialization branch** (core's status design, ADR 0016). An uncognized node reports `Cognition: Not created (add on demand)` with `Own issues: 0` / `Descendant issues: 0`, no legend, and **no trailing hints** — the `missing` fact is itself the on-demand affordance; core's `create-cognition` action carries role `optional-on-demand` and the adapter filters it out of imperative hints. A judge must read "not created + no hints" as the on-demand branch (`coggit_add` is called only when that node needs cognition), not as a defect or a dead end.
6. **`Cognition: <path>` present while the file is missing** (status-hit-null) — it is the *intended* location, not proof of existence. (With `cognitionPresence: 'missing'` the renderer prints the `Not created (add on demand)` line instead.)
7. **The re-check is a `suggestedAction`, not a separate `verify` field** — non-miss add/resolve failures carry one `suggestedActions[]` entry with `operation: 'status'` (`Call coggit_status with sourcePath="…".`) so the model re-inspects current state. Success branches carry none: add's returned `cognitionPath` proves the write, resolve re-records the pair (fresh), so a trailing re-check would be redundant.
8. **`stale` carries two signals in one ordered plan — the handbook-sync step leads, the resolve step trails** — two steps, not a contradiction. Core emits the ordered pair `sync-cognition-with-source` (a `handbookId`-bearing authoring step) then `resolve-stale-cognition` (`operation: 'resolve'`); the row's `actions=sync-leaf,resolve` keeps that order, the `Actions:` legend defines each tag once, and the trailing hints render the own-node steps as the leading handbook-skill hint plus `Call coggit_resolve with sourcePath="…".`. The model must sync (or confirm the cognition already covers the source) before resolving — the resolve tool's own description ("after … confirming the cognition correctly covers the source") is the gate. A stale pair whose own node is fresh never gets a trailing resolve (see #16).
9. **Row `LEVEL` is core's severity semantics, passed through unchanged** — `WARN` for `outdated-cognition`, `INFO` for `missing-cognition` (when it appears under `all` visibility). Severity ranks *risk of acting on misleading info*, not "brokenness": missing is the normal not-yet-created state; stale means an existing cognition has drifted.
10. **`Try:` candidates can be fuzzy name matches, not just prefix repairs** (`src/nope.ts` → `coggit/src/note.ts`) — deliberate recall-maximizing candidates from core. The agent must verify the candidate is the intended file before retrying.
11. **Empty-vs-omitted is per-construct, not uniform** — add/resolve keep `surfaceHints` always present (possibly `[]`) because it is the stable "next step" slot; `pathHints`/`error` are omitted when empty. In status text, `Legend:`/`Actions:` blocks and the trailing hints appear only when non-empty.
12. **Trailing hints restate the own-node structured actions in copy-pasteable form** — "Call `coggit_resolve` with `sourcePath=…`" duplicates the row's action + path. Deliberate: the model gets a concrete invocation, while the rows carry the shared tag semantics ("keep your own surface addresses", core's adapter contract / the compact action-tag FR).
13. **`resolve-error-content-changed` echoes the canonical node path** — core resolves the node before the acceptance guard runs, so a post-resolution failure (content changed mid-operation) reports the canonical path, matching `addOperation`'s canonical-on-found split (core `1b1b9db`). The re-check hint then re-diagnoses via `coggit_status`, which canonicalizes.
14. **The add-success handbook hint says "this cognition" right after creating it** — "authoring or editing" covers the create-then-complete flow; the hint is a standing precondition, not an assertion that a doc exists.
15. **A folder can be `Status: Stale` while its own README is fresh** — the `Status:` header aggregates the worst of own + descendant (`fresh` < `stale` < `conflict`), so one stale descendant marks the folder stale. That is `status-hit-folder-mixed`: `Own issues: 0` (no own row), one descendant row driving the aggregated `Status: Stale`.
16. **Descendant next steps live in the descendant rows' `actions=`, never in the trailing hints** — core keeps the top-level `suggestedActions` channel own-node-only and dedupes descendant actions into the triage channel (core `6620c1f`+), which the renderer shows as the descendant row's `actions=` tags defined once in the `Actions:` legend — matching the CLI/MCP text surface. So `status-hit-folder-mixed` carries **no trailing resolve hint** (the folder's own README is fresh); the stale descendant's sync+resolve pair appears in its descendant row. A judge must route the descendant's next step from that row, not from the trailing hints.

## How to grade a run

1. Read the judge's Part 1 and check the per-line (status) / per-field (add/resolve) keys above. An item is "understood" if the judge's meaning matches, even in different wording.
2. Read Part 2 and check the per-scenario table. The judge must correctly distinguish `Cognition: Not created (add on demand)` with no hints (materialization branch, add-on-demand) from the `Path not found…` miss (retry path) and must reach `resolve` on stale.
3. Read Part 3. A red flag is a **real finding only** if it is not in the known-intentional list above. Real findings are actionable design gaps.
4. Across N runs, aggregate: items/actions all runs agree on = converged; disagreements or real (non-listed) red flags = investigate.
