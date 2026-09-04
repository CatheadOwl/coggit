---
description: @catheadowl/dsh-coggit —— CogGit runtime adapter for dsh:ctx.coggit 服务门面 + coggit_* 工具 + handbook 技能 + 顶层 system-prompt section
---

# @catheadowl/dsh-coggit

CogGit runtime adapter for dsh: a `ctx.coggit` service facade plus model-facing `coggit_*` tools over the CogGit SDK (`@coggit/core`, `@coggit/runtime-node`). It gives a dsh agent the same paired-cognition workflow the CogGit MCP server exposes — discover, diagnose, add, and resolve cognition documents.

## What it provides

- **`ctx.coggit`** — a `CoggitService` (single-package fold) whose methods take the workspace root, discover CogGit projects under it (cached per root), and read fresh state on every call (reconcile-on-read). Methods: `status`, `add`, `resolve`, plus the single-turn batch pair `buildSnapshot` / `statusWithSnapshot` used by the cognition-link enricher (below). The model-facing `snapshot`/`routes` tools remain removed — see [Removed capabilities](README.md#removed-capabilities).
- **cognition-link enricher** — a declarative prompt-middleware provider (`cognition-link-enricher`, kind `cognition-link`, priority `10`, canonical band) that, for each resolved prompt path, emits a `cognition-link` relates item pointing at the paired cognition document with a `stale` meta marker (miss / missing / not-applicable → no item); on an unconfigured workspace it short-circuits before the per-turn snapshot build. It builds one snapshot per turn (`buildSnapshot`) and reuses it across paths (`statusWithSnapshot`), and registers through the `ctx.inject(['promptMiddleware'], ...)` soft dependency — coggit loads and works without prompt-middleware present.
- **Session-scoped workspace** — the workspace is NOT a config: each `coggit_*` tool call resolves CogGit projects under the CALLING session's workspace (`SessionHeader.cwd`), mirroring dsh-tool-fs/dsh-tool-bash; discovery results are cached per workspace root. Every face still registers unconditionally; the MODEL-VISIBLE surface (the `coggit:overview` section and the `coggit_*` tool schemas) is gated lazily per session — a workspace with no `.coggit/config.yaml` at its exact root hides them (root-only: the gate does not walk up to ancestor configs, unlike the SDK's own discovery), while the execution face still reports empty state if reached directly.
- **Handbook skills** — the dsh analog of the MCP server's `coggit://handbook/<kind>` resources: the node-kind handbooks register as runtime skills (`coggit-handbook-leaf`, `coggit-handbook-skeleton`) via `ctx.skills`. They are **model-only** (`invocation: { modelInvocable: true, userInvocable: false }`): the model sees them in the skill catalog and loads a body with the `skill` tool, but a user `/name` gesture never injects one — only a `coggit_*` tool result's `surfaceHints` routes the agent to load the handbook. The aggregate `all` handbook stays out of the catalog, mirroring the MCP server's model-facing choice.
- **Top-level guidance section** — a `system-prompt` section (`coggit:overview`, order 117) carrying the SDK's surface-neutral `minimal` form (`getCoggitSystemPrompt('minimal').content`), the dsh analog of the MCP server's `instructions`. Conditional injection: the `text` is a lazy provider that renders only when the calling session's workspace has `.coggit/config.yaml`; otherwise it returns empty text and `renderPrompt` drops the section. The fuller `standard` form is still a TODO upstream.
- **Surface-hint translation** — core hints are surface-neutral: operation ids (`snapshot`/`status`/`add`/`resolve`/`routes`) and opaque `handbookId` (the coggit core boundary rule). The adapter owns the mapping to this surface (`views.ts::operationToolName` / `handbookSkillName`) and appends a `surfaceHints` array to every operation result: `coggit_*` tool calls for next-step actions and the matching handbook skill for authoring guidance. Nothing in the projection relies on naming coincidence.
- **Web init UI** — when the plugin is present in a Web profile, the browser contributes a `CogGit` tab under Settings → Plugins addressing the workspace the user is looking at: the workspace owning the **currently selected session** first, then the most recently active workspace, then the server cwd (`workspace-resolve.ts`, mirroring the ui-workspace navigation convention). If that workspace is not initialized, the tab offers a one-time initializer for `source_root` and `cognition_root`; if it is already initialized, it renders the ready state.
- **Three model-facing tools**, mirroring the CogGit MCP names so agent habits transfer:

| Tool | Parameters | Effect |
|---|---|---|
| `coggit_status` | `sourcePath?` (default `.`) | Diagnose one node (or the whole root): canonical compact status view — issue/action-tag rows, legends, own/descendant counts. |
| `coggit_add` | `sourcePath` (required), `kind?` (`auto`/`leaf`/`skeleton`), `overwrite?` | Create a missing cognition doc and register it. |
| `coggit_resolve` | `sourcePath` (required) | Accept a stale source/cognition pair as reviewed. |

All tools return a **JSON-safe projection** of the SDK operation result (the model sees `render` = pretty-printed JSON text) plus the adapter-computed `surfaceHints`. Each tool condenses the SDK result into a **branch payload** rather than passing it through. `coggit_status` splits hit/miss:

- **Hit** — a matched node omits `found` (implied), `nodeKind`, `project`, and `handbookId` (no next-step signal; the last is redundant with the literal `surfaceHints`), and carries core's **canonical `StatusAgentPresentation`** —the same structured projection the upstream CLI and MCP text render (`statusAgentPresentation.ts`, upstream `d30249a`): `sourcePath`/`cognitionPath`, `cognitionPresence`, the whole-node `status`, the split counts `ownIssueCount`/`descendantIssueCount`, log-style issue rows split into `ownIssues`/`descendantIssues` (`{ sourcePath, level, issueTags, actionTags, optionalActionTags }`), and `issueLegend`/`actionLegend` defining each issue/action tag once. Descendant next steps appear in the descendant rows' `actionTags` (defined once in `actionLegend`) — not in the top-level `surfaceHints`, which carries only the current node's steps.
- **Miss** — an unmatched path carries `found: false` and `pathHints` (the fuzzy source-path candidates, only when non-empty). The SDK's descriptive miss prose (`pathMissMessage`/`pathHintMessage`) is dropped — `found: false` already says "no match", and the candidates are the actionable signal. A miss with candidates turns them into a `Try one of these source-root-relative paths: ...` `surfaceHints` line (no re-check — re-running status on a missed path just misses again); a miss with no candidates returns an empty `surfaceHints`.

A hit's next step comes from core's surface-neutral `suggestedActions`, not from adapter branching on the issue `code` or `status: null`. Core synthesizes a `create-cognition` action (operation `add`) when the node has no paired cognition yet (`cognitionPresence === 'missing'` — the **materialization branch** of upstream ADR 0015: missing cognition is a normal precondition, not an issue, so under the default maintained-issue visibility an uncognized node carries empty rows/legends), and for maintained stale cognition an **ordered pair**: a handbook-bearing `sync-cognition-with-source` step first, then a `resolve-stale-cognition` action (operation `resolve`). The adapter maps each to a `surfaceHints` line — the sync step becomes the handbook-skill hint (it leads the resolve call), an operation action becomes `Call coggit_<op> with sourcePath="<path>".`. Resolve success is itself the confirmation of fresh, so no re-check follows.

**Descendant next steps live in the descendant issue rows, not in the top-level `surfaceHints`** — core keeps the top-level `suggestedActions` channel own-node-only and dedupes descendant actions into the triage channel (upstream `6620c1f`+), and `statusAgentPresentation` renders them as the descendant rows' `actionTags` with the tags defined once in `actionLegend`. So a folder whose own README is fresh but has one stale descendant carries no top-level resolve hint; the descendant's sync+resolve pair appears in its `descendantIssues` row.

This is **full alignment with the upstream status format**: the hit view is core's canonical `StatusAgentPresentation` verbatim — the same shape the CLI (`renderStatusAgentInspectionText`) and MCP text render, delivered as JSON instead of text. The adapter only appends its `surfaceHints` addressing (the "keep your own surface addresses" rule of upstream ADR 0015 / the compact action-tag FR); nothing here is re-derived from issue `code` or `status: null`, and the diagnostic `code` stays in core's raw result. `sourcePath` is always **source-root-relative** (e.g. `src/main.ts`, `src/app`, `.`), never an absolute filesystem path.

`coggit_add` and `coggit_resolve` split success/failure the same way:

- **Add success** — `{ success: true, created, kind, sourcePath, cognitionPath }`. `created: false` means "already exists" (not a failure). Dropped: the `project` URI context and `handbookId` (carried by `surfaceHints`), plus the failure null-fillers (`created`/`kind`/`cognitionPath` = `null`). Success is self-confirming — the returned `cognitionPath` proves the write, so no re-check follows.
- **Resolve success** — `{ success: true, sourcePath, cognitionPath }`. The registry `sourceKey` and `verificationTimeMs` are receipt data, not next-step signals, so they are dropped with the `project` URI context. `surfaceHints` is `[]` — resolve re-records the pair as accepted, which is already the confirmation of fresh.
- **Failure (both)** — `{ success: false, sourcePath, error: { code, message }, pathHints? }`. The error `code`/`message` is the signal; `pathHints` appears only on a `path-not-found` miss with fuzzy candidates. A miss with candidates turns them into the same `Try one of these source-root-relative paths: ...` `surfaceHints` line (no re-check — re-running status on a missed path just misses again); any other failure emits one re-check action (`Call coggit_status with sourcePath="…".`) so the model re-inspects current state. The re-check is **failure-only** — never attached to a success.

## Model experience

The intended loop, matching the CogGit MCP guidance:

1. `any_routes` over the workspace/cognition root → find the document to read or the surface to look at.
2. `coggit_status` for that `sourcePath` → read the status, issue/action-tag rows, and legends *before* explaining or editing, and *again after* editing. Omitting `sourcePath` diagnoses the whole project (the root's own status plus every issue-bearing subtree node), so it also serves as the entry point; an uncognized path inspected directly reports `cognitionPresence: "missing"` with the `create-cognition` add action.
3. If cognition is missing → `coggit_add` (keep `overwrite` false unless the user asks to regenerate), then load the handbook skill named in `surfaceHints` with the `skill` tool before completing the template.
4. If cognition is stale → load the handbook skill named in `surfaceHints` (it leads the resolve call), sync the paired doc, then `coggit_resolve`.

A status/read operation never mutates; only `coggit_add` (writes a file) and `coggit_resolve` (re-records acceptance) change state.

## Configuration

The plugin takes **no configuration** (the `Config` schema is empty, reserved for future deployment-wide options). The workspace deliberately follows runtime facts instead of config:

- Model-facing tools: the calling session's `SessionHeader.cwd` (the workspace the GUI session was created in).
- Web init UI: the browser passes the workspace of the currently selected session (most recently active workspace as fallback) over the `coggitInit/*` Remote; absent selection falls back to the server cwd.

## Limitations (v1)

- Output is a JSON-safe projection (JSON text), not the CLI/MCP text rendering; the model reads the JSON directly. `coggit_status` returns the canonical `StatusAgentPresentation` as JSON (same shape the CLI text renders, per the status section above), not the raw SDK operation result, and does not adopt the text formatter (`renderStatusAgentInspectionText`).
- Conditional injection is per-session lazy, not boot-time: the section and `coggit_*` tool schemas appear/disappear on the next assembly (next model step) when `.coggit/config.yaml` is created or removed — in native tool mode. Under Code Mode (`mode: code`/`both`) the generated `tools:sdk` section text is built from the tool registry before the assemble waterfall, so it still lists the `coggit_*` bindings; the waterfall filter removes only the native schemas. Config CONTENT edits (`source_root`/`cognition_root`) mid-session are NOT re-discovered — the service caches discovered projects per workspace root, so changing roots requires a profile restart.

## Removed capabilities

`coggit_snapshot` and `coggit_routes` are **removed** from this surface (2026-08), not just unregistered:

- `coggit_snapshot` (scope-tree view, tracked/untracked counts, `nextScopes`) —the model-facing scope-tree view is not adopted: `coggit_status` with default `.` diagnoses the whole project (own status + every issue-bearing subtree node), and an uncognized path inspected directly reports the materialization branch (`cognitionPresence: "missing"` + `create-cognition` add action), which covers the discovery need without the scope-tree view. The underlying snapshot mechanism is nonetheless reused today, but only as a **service batch surface** (`buildSnapshot` / `statusWithSnapshot`) behind the cognition-link enricher — never as a model-facing tool.
- `coggit_routes` (flat route index of tracked pairs) — redundant with `any_routes` for navigation, and its v1 projection duplicated `entries`/`diagnostics` inside the `routes` field without sourcePath/depth/ format refinement.

If either is needed again, restore from git history (they were deleted, not commented — the pre-removal commit `0c2c0aa` still carries their implementations). The decision record lives in `dsh-plugin-dev_cognition/coggit/src/README.md`.

## Development

This package is the **dsh adapter of the CogGit SDK** and lives in the coggit
repo as an **independent sibling project** (ADR 0022): it is NOT part of the
root pnpm workspace (`packages/*` stays pure-registry and clean-machine
green); it owns its install, lockfile, and host resolution layer. It is
installed into a profile with `dsh plugin add <path>` (bare path = `link:`
symlink).

Dependency faces (asymmetric by rule):

- **Host face (runtime + types)** — every `@deepseek-ai/*` import is a
  **peerDependency** provided by the dsh host; `autoInstallPeers` stays off
  (the host's prerelease closure deadlocks registry resolution). Dev-time
  resolution is one machine-local, uncommitted **scope junction**
  `node_modules/@deepseek-ai` → `~/.dsh/profiles/node_modules/@deepseek-ai`
  (the host-maintained install closure — this package is an installed-closure
  consumer, not a source consumer). Rebuild: `pnpm --dir . relink`. A bare
  `pnpm install` purges the junction — always re-run `relink` after install.
- **Library face** — `@coggit/core` + `@coggit/runtime-node` as `link:` into
  `../../packages/*` (they keep their own `node_modules`, so `link:` transitive
  resolution is safe; run the root workspace `pnpm install` first).
  `@catheadowl/dsh-extras` and dev-only `@catheadowl/dsh-eval` are registry
  versions.
- **Host source (the only residual)** — `build:client` uses the host's tsdown
  and the unpublished `clientBundle` preset via the machine-level `DSH_REPO`
  anchor (no committed path carries it; the script fails loud with remedy when
  the anchor is absent). Everything else — typecheck, build, tests, eval —
  runs without any host source checkout.

Then install into a profile and smoke-load:

```bash
dsh plugin --profile <name> add <path-to>/coggit/adapters/dsh
dsh --profile <name> --dump-config | grep dsh-coggit
```

Rebuild loop: `pnpm --dir . build` (tsc → `lib/types`), then restart the
profile (plugins load at boot). The browser bundle additionally needs
`pnpm --dir . build:client` (tsdown → `lib/client.js`) — the web profile
serves `lib/client.js`, not sources; a rebuilt bundle reaches a running GUI on
page refresh. `lib/index.js` is a legacy tsdown artifact the patched manifest
lookup still needs (kept until upstream fixes the out-of-tree manifest
lookup); the test suite asserts its presence — copy it from a previous
build site or run `build:client` once with `DSH_REPO` set.

## Tests

Verification does not need a dsh server. The suite exercises the **built `lib/` artifacts** with `node --test`, so tool-surface and business-logic changes are checked in-process and in seconds, not by restarting the profile and eyeballing the GUI:

```bash
pnpm --dir . build   # first: the tests import lib/, so rebuilt artifacts are required
pnpm --dir . test
# one-shot: typecheck + build + test
pnpm --dir . verify
```

Coverage:

- `test/shape-and-views.test.mjs` — function-plugin shape (no default export), and the pure view functions (`handbookSkillName`, `operationToolName`, `renderJson`, `toJsonValue`, `statusView`, `surfaceHints`).
- `test/workspace-resolve.test.mjs` — the init tab's workspace-target resolution (`resolveWorkspacePath`): selected-session ownership, recent fallback, pending-phase gating, host-order tie-break.
- `test/tools.test.mjs` — mock `ctx.tools.register` capture: exactly three `coggit_*` tools registered, removed tools absent, and `execute` passthrough.
- `test/service.test.mjs` — real `CoggitService` (constructed over a real cordis `Context`) against an on-disk temp fixture: status discovery, path-miss, add writes a cognition doc, resolve re-records, per-root project caching, and the `buildSnapshot` + `statusWithSnapshot` batch surface matching independent status calls.
- `test/cognition-link-provider.test.mjs` — the `resolveCognitionLink` pure projection (fresh/stale/miss/missing/not-applicable), the per-turn snapshot reuse in `createCognitionLinkProvider`, and the `registerRelates` soft-dependency registration via a mock `ctx`.

The `--test-isolation=none` flag is required in this environment: `node --test` spawns a child process per file by default, which the dsh file sandbox blocks (`spawn EPERM` on piped stdio). It also means the test entry points are explicit file paths, never a directory.

## Agent eval

Agent-level verification uses the shared `@catheadowl/dsh-eval` framework (registry devDependency; host CLI located through the node_modules resolution layer). Behavior cases check tool choice and real tool round-trips; the comprehension review asks whether a fresh model can understand the projected output and infer the next action:

```bash
pnpm --dir . eval:mock   # deterministic layer, no API key: scripted model drives the real tool pipeline
pnpm --dir . eval        # real-model intent cases (skips without a credential)
pnpm --dir . eval:review # repeated fresh-model design review, human-graded against rubric
```

The normalized layout is documented in [`eval/README.md`](eval/README.md): behavior cases live under `eval/behavior/{real,mock}/`, while the separate `eval/comprehension/` experiment keeps frozen raw inputs, a blind prompt, and a hidden rubric. Generated artifacts stay under nearby `.runs/` directories. A rebuilt `lib/` is required first (`pnpm --dir . build`).

## What still needs a dsh profile (rare)

The suite covers every layer up to — but not including — a real Cordis boot: resolving `inject`, `cordis.patch.yml` composition, and profile config. Those matter only when the *structural* surface changes (tool names, `inject`, `Config`, the patch file, plugin name) and are verified by a one-shot headless boot, not a long-lived web server (see the dsh plugin-dev handbook's debug topic, Part 6, in the dsh-extra repo). Routine business-logic and tool-surface edits do not reach this layer.
