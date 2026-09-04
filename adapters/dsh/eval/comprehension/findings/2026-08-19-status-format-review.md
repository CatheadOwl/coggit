# 2026-08-19 — status format + workflow

Round after the `verify` → `suggestedActions` collapse (adapter `7b5346e`, core `5817527`). Two review runs, both `--runs 1` (sampling; the graded eval uses `--runs 3`). `run-1.txt` is the post-fix review; the pre-fix review was the first `run-1.txt` (13 flags, since overwritten).

## What changed before this review

- fixtures: dropped the `verify` field, completed `status` hit `inspection` (full `NodeStatusInspection`), added `status-hit-folder` / `add-already-exists` / `add-success-skeleton`.
- `coggit_status` description now covers the miss shape (`found:false` + `pathHints`) and states `surfaceHints` is always present.
- rubric: re-check-as-suggestedAction (item 7), plus items 8–14 for the tensions the first run surfaced.

## Verdict

**Workflow comprehension is converged** — the fresh reviewer's Part 2 built the correct `status → (add | sync-then-resolve) → load handbook skill` model and got all 15 scenarios' next actions right. The remaining red flags are either rubric-covered (`intentional`) or genuine but core-level (`open`, listed below). Nothing here is an adapter-side blocker.

## Findings

### 1. Path prefix `coggit/…` is undocumented and contradicts "source-root-relative"
- **Triage**: `fixture` + context — the reviewer has workspace access, so it checked the real tree and found no `coggit/` directory. The `coggit/` prefix is the fixtures' illustrative *project qualifier*, not the review workspace.
- **Resolution**: accepted; documented here. A cleaner blind review would run with **no workspace/tool access** (see open items).

### 2. `resolve-error-content-changed` uses unprefixed `src/b.ts` yet got past resolution
- **Triage**: `genuine` (core) — the fixture is faithful: core's resolve failure echoes the raw input `sourcePath`, while add failures echo the canonical node path. The asymmetry is core's.
- **Resolution**: rubric item 13 documents the add-vs-resolve asymmetry.
- **Status**: `open` (escalated: core 2201 — resolve failure echoes raw sourcePath).

### 3. `pathHints` can name non-existent paths (`coggit/src/note.ts`)
- **Triage**: `intentional` — recall-maximizing fuzzy candidates (rubric item 10). The reviewer's "verified it doesn't exist" is again the fixture/workspace mismatch.
- **Status**: `accepted`.

### 4. `cognitionPath` has two meanings in one payload (expected vs actual)
- **Triage**: `genuine` (core schema) — top-level is the *expected* paired path (present even when `cognitionPresence: "missing"`); issue-level is the *actual* path (`null` when absent).
- **Status**: `resolved` (core 2202) — core reframed it: both fields are the *expected* path; the difference was two null *encodings* (`string | null` vs `string | undefined`), not two meanings. No "actual" variant exists.

### 5. `null` is overloaded (`status:null` = no cognition; `descendantStatus:null` = no descendants)
- **Triage**: `genuine` (core schema).
- **Status**: `resolved` (core 2202) — null-vs-absent convention documented per field.

### 6. Severity counterintuitive (missing = `info`, stale = `warning`)
- **Triage**: `intentional` — core's severity ranks risk-of-misleading-info, not brokenness (rubric item 9).
- **Status**: `accepted`.

### 7. `add-already-exists` returns `success: true, created: false`
- **Triage**: `intentional` — `success` = "processed", `created` = "actually wrote" (rubric field key `created` + scenario table).
- **Status**: `accepted`.

### 8. `surfaceHints` leads with `resolve`, baiting a literal agent into a false review
- **Triage**: `genuine` (core ordering) — stale emits `surfaceHints: ["Call coggit_resolve…", "load skill…"]`, but the correct flow is sync → resolve; the sync signal lives only in the issue's `suggestedActions`.
- **Resolution**: rubric item 8 now states the ordering caveat explicitly.
- **Status**: `open` (escalated: core 2200 — stale hits should lead with handbook sync before resolve).

### 9. `status-hit-folder` surfaces a descendant issue but doesn't route it
- **Triage**: `genuine` (core) — descendant stale issues are listed but get no `surfaceHint` of their own; only the folder's resolve is hinted.
- **Status**: `open` (escalated: core 2203 — per-descendant next step).

### 10. No fixed schema (outcome-dependent presence)
- **Triage**: `intentional` — rubric items 1 & 11.
- **Status**: `accepted`.

### 11. `surfaceHints` duplicate `pathHints` + require prose parsing
- **Triage**: `intentional` — rubric items 2 & 12 (copy-pasteable prose vs structured list).
- **Status**: `accepted`.

### 12. `content-changed` defined only on the source side
- **Triage**: `genuine` (core doc) — the guard contract is under-specified.
- **Status**: `resolved` (core 2202) — guard compares accepted-pair identity (SHA-256), not mtime.

### 13. Folder `status` aggregation rule is unobservable
- **Triage**: `fixture` — only one all-stale folder sample; no mixed fresh/stale case.
- **Status**: `resolved` — `status-hit-folder-mixed` added; the aggregation rule is now observable (and filed as new core draft, item 6).

### 14. Domain vocabulary ("cognition", "fresh/stale") undefined in descriptions
- **Triage**: `intentional` — descriptions are deliberately concise; the glossary lives in the handbook skill, which `surfaceHints` routes the model to load.
- **Status**: `accepted`.

### 15. Handbook hint over-triggers on `status-hit-fresh`
- **Triage**: `accepted` (minor) — the hint is a standing precondition ("if about to author/edit"), rubric item 14.
- **Status**: `accepted`.

## Open items (next design round)

Core-level items are filed as issues in `vscode-plugins/TODO/ISSUES/`:

1. ~~**Blind review leaks workspace**~~ — **resolved**: the dsh review adapter now runs tool-less — a generated `--patch` overlay disables every host model-facing tool row and the reviewer's cwd is the empty run dir (`dsh-plugin-dev/eval/src/adapters/dsh/review.mjs`). Re-run confirmed (see below). (dsh-side, not filed to core)
2. **Core: resolve action leads the stale hints** (#8, Open) → `20260819-2200-stale-resolve-hint-leads-surfacehints.md`.
3. **Core: resolve failure path should canonicalize like add** (#2, Open) → `20260819-2201-resolve-failure-echoes-raw-sourcepath.md`.
4. **Core schema clarity** — `cognitionPath` null-encoding, `null` overloading (#4/#5), `content-changed` contract (#12) → `20260819-2202-operation-result-schema-coherence.md` (Resolved on core).
5. **Core: descendant routing** (#9, Open) — folder hits list stale descendants with no per-descendant next step → `20260819-2203-descendant-routing-needs-per-descendant-next-step.md`.
6. **Core: folder `status` aggregation rule is undocumented** (re-run flag #3, new) — whole-node `status` = worst of own + descendant (`fresh` < `stale` < `conflict`); the contract never states it. Draft below.
7. ~~**Fixture: add a mixed fresh/stale folder sample**~~ — **resolved**: `status-hit-folder-mixed` (own README fresh + stale descendant) added to `fixtures.json`; rubric item 15 + the scenario next-action row document the aggregation rule. (dsh-side, not filed to core)

The core repo (`vscode-plugins/codebase/coggit`) owns items 2–6; this repo's job is to keep the projection, description, fixtures, and rubric honest about them until core resolves them. Item 4 (2202) is resolved on core and the adapter reading can now be reconciled; items 2, 3, 5 are open; item 6 is a new draft to file. The two dsh-side items (1 and 7) are resolved here.

## New core issue draft — item 6 (folder status aggregation rule)

`status` on a folder aggregates own + descendant health (worst wins), but the contract never states it

Status: Open (draft) Created: 2026-08-19

### Concern

A folder hit reports `status` (whole node), `ownStatus` (this node) and `descendantStatus` (subtree), but the derivation rule for `status` is not part of the contract. The tool-less re-run inferred it from the mixed-folder sample — "a folder is `stale` when its own pair *or* any descendant pair is stale" — and flagged "the aggregation rule is nowhere documented — I inferred it. Anyone reading `status: stale` on a folder could wrongly assume the README itself is stale."

The rule is `combineObservedStatus` (`status/index.ts`): worst-of by priority `fresh` < `stale` < `conflict`, so `status = combine(ownStatus, descendantStatus)` and `descendantStatus` is the same worst-of over tracked descendants. A folder whose own README is fresh but has one stale descendant is therefore `status: stale, ownStatus: fresh, descendantStatus: stale` (`status-hit-folder-mixed`). Correct behavior; only undocumented.

### Assessment

Severity: P3 / documentation. No detector or mutation change — the same class as the resolved 20260819-2202, which documented these fields' null meanings but not their derivation relationship.

### Current State

- `status/index.ts::combineObservedStatus` (65–88): the priority table and worst-wins selection are undocumented.
- `status/index.ts::aggregateNodeStatus` (95–155): derives descendant then whole status; no consumer-facing JSDoc for the rule.
- `statusTypes.ts::NodeStatusInspection` (159–178): carries the null-convention notes (from 2202) but no "status = worst of own + descendant" note.

### Design Direction

State once at `NodeStatusInspection.status` (and the operation DTOs): whole-node `status` is the worst of `ownStatus` and `descendantStatus` by priority `fresh` < `stale` < `conflict`; `descendantStatus` is the same worst-of over tracked descendants. A doc note is sufficient; no rename or behavior change.

### Non-Goals

- Do not change the aggregation behavior or priorities.
- Do not fold in descendant routing (20260819-2203) — that is a next-step behavior decision, this is the field's derivation contract.

### Follow-Up

- dsh adapter: rubric item 15 records this rule as "known intentional"; once core states it, the adapter note can point at the core contract.
- MCP/CLI: re-read their folder `status` rendering against the stated rule.

### Related

- 20260819-2202: resolved the same fields' null conventions; this is the complementary derivation note.
- 20260819-2203: descendant routing (separate behavior decision).

## Re-run confirmation (tool-less + mixed fixture)

Re-ran the blind review after resolving the two dsh-side items. The reviewer now opens with "without running any tools", so the workspace-inspection noise behind findings #1–#3 is gone; the residual `coggit/`-prefix flag is the accepted #1 (fixture qualifier vs description example), raised from the text alone rather than by checking the real tree.

The mixed-folder fixture works: the reviewer inferred the aggregation rule ("a folder is `stale` when its own pair *or* any descendant pair is stale") and read `status-hit-folder-mixed` correctly as "do NOT resolve the folder — drill into the stale descendant". It also surfaced the descendant-routing gap as its sharpest red flag (core #9, already filed), now observable rather than hypothetical. The remaining flags are rubric-covered (`intentional`) or the already-filed core items.

# zh-cn
决定已执行。做了三件事：**建了一个 findings 台账子文件夹**、**做了一轮设计收敛**、**重跑真实盲评并记录结论**。

## 1. 新增台账：`eval/comprehension/findings/`

- `README.md` — 定义了记账格式（Finding / Triage / Resolution / Status）和收敛判据：**重跑后剩下的 red flags 全部属于 `intentional` 才算稳**。
- `2026-08-19-status-format-review.md` — 记录本轮 15 条 red flags 的三分法（intentional / fixture / genuine）+ 每个的处置 + **open items 清单**。

## 2. 这一轮做的设计收敛

- **`coggit_status` 描述补上 miss 形态**（`found:false` + `pathHints`），并说明 `surfaceHints` 每次都带 —— 直接消掉上轮「描述没覆盖 miss」的真问题。
- **fixtures 补全保真**：status 命中补全 `inspection`（sourcePath/cognitionPath/status/ownStatus/descendantStatus/cognitionPresence）、issue 补上 `cognitionPath`、新增 `status-hit-folder`（含非空 descendantIssues）、`add-already-exists`（created:false）、`add-success-skeleton`（skeleton）—— 消掉「cognitionPath:null」「sourcePath 不回显」「skeleton/created:false 从没演示」这些假警报。
- **rubric 扩到 14 条 known-intentional**：覆盖 severity 排序、stale 双信号（sync vs resolve）、模糊 pathHints、空字段省略、surfaceHints 与结构字段重复、resolve 失败回显 raw path、handbook hint 措辞等。

## 3. 重跑真实盲评的结论

**workflow 已收敛** —— 新 reviewer 的 Part 2 把 15 个场景的下一步全部推对（`status → add|sync-then-resolve → 加载 handbook skill`）。这验证了精简后的 `surfaceHints` 契约是「能被新手模型读懂」的。

剩下的是**核心层（core 仓）的真实张力**，不是 adapter 侧能改的，已在台账 `open items` 里登记：

1. **stale 场景 resolve 排在 hint 首位**，会诱使「字面照做」的 agent 在未 sync 前就 resolve（sync 信号只在 issue 的 suggestedActions 里）—— 这是最值得升级给 core 的一条。
2. resolve 失败回显 raw path、add 失败回显 canonical path 的不对称（core 不一致）。
3. `cognitionPath` 一个字段两种语义（期望路径 vs 实际路径）、`null` 多义（无认知 vs 无后代）。
4. **盲评本身泄露了 workspace**：reviewer 能调工具查真实目录，制造了路径前缀那 3 条噪声 —— 建议以后用无工具/无 workspace 的 reviewer profile。

## 交付物

改动集中在 `dsh-plugin-dev/coggit/`：`eval/comprehension/findings/`（新增台账）、`fixtures.json`、`rubric.md`、`src/tools.ts`、`README.md`（以及上一轮的 test/、`intent-add.eval.mjs`）。单测 36/36 通过；盲评 `--runs 1` 两次均成功（产物在 `.runs/`，不入库）。

一个提醒：现在台账里「open items」2–5 都属于 `vscode-plugins/codebase/coggit`（core 仓，本 workspace 外）。要不要我把这几条整理成一份可直接贴给 core 的 issue 草稿，还是先停在这里等你定优先级？
## 2026-08-19 晚 — core 已解决 open items，dsh 适配层对齐新 status 格式

The core repo landed the status-format round the same evening; every escalated core item is now resolved, and this commit realigns the adapter's projection / description / fixtures / rubric in one pass:

- **2200 stale-resolve-leads** → core `4a34ca2` (stale next steps lead with a handbook-bearing sync action) + `d30249a`/`6620c1f` (compact action-tag presentation; descendant actions deduped into the triage channel).
- **2203 descendant routing** → core `2550c68`/`40f8702` (subtree triage with structured-only per-node actions).
- **2202 schema coherence** → core `698d785` (unified operation result schema).
- **2201 resolve failure echoes raw path** → core `1b1b9db` (canonical path on post-resolution failures).

Adapter alignment in this commit:

- `fixtures.json` regenerated to the current core contract: every hit scenario now carries `inspection.triage` (own entries facts-only, descendant entries carry the ordered sync+resolve pair), stale scenarios lead with `sync-cognition-with-source` (`handbookId`) before `resolve`, `status-hit-folder-mixed` locks descendant-actions-only-in-triage (`suggestedActions: []` top-level), `status-hit-null` locks the core materialization branch (missing cognition is NOT an issue: empty rows/legends, `cognitionPresence: 'missing'` + `create-cognition` add action), and `resolve-error-content-changed` uses the canonical path. Previously the missing `triage` field made all five hit scenarios crash `coggit.review.mjs` (`Cannot read properties of undefined (reading 'map')`).
- `src/views.ts` — the `coggit_status` hit view is now core's canonical `StatusAgentPresentation` verbatim (full alignment with the upstream status format, upstream `d30249a`): the same structured projection the CLI and MCP text render, delivered as JSON — `ownIssueCount`/`descendantIssueCount`, log-style rows (`level`/`issueTags`/`actionTags`/`optionalActionTags`), and `issueLegend`/`actionLegend`. The adapter's `triageView` and the `StatusPresentationView` pass-through are removed; `surfaceHints` stays the adapter's own surface addressing (core's "adapters map, they do not reinvent" rule).
- `README.md` corrected: documents the canonical view, the sync-lead, descendant routing via descendant rows + `actionLegend`, and the materialization branch (missing cognition is not an issue).
- `rubric.md` rewritten for the canonical view: field keys cover rows/legends/ counts; items 3/4/5/8/9/12/16 updated; new item on the materialization branch.
- `src/tools.ts` `coggit_status` description names the rows/legends shape and the materialization branch; tests lock the canonical projection and descendant routing via descendant rows.