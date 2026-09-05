# Development

Contributor workflow for `@coggit/dsh`. This page lives in the repository
only — it is not shipped in the npm tarball.

## Surface design: why only three tools

The model-facing surface is deliberately smaller than the CogGit SDK / MCP
server exposes — only what the dsh agent actually needs survives:

- No `coggit_snapshot` (scope-tree view, tracked/untracked counts,
  `nextScopes`) — `coggit_status` with default `.` diagnoses the whole
  project (own status + every issue-bearing subtree node), and an uncognized
  path inspected directly reports the materialization branch
  (`cognitionPresence: "missing"` + `create-cognition` add action), which
  covers the discovery need without the scope-tree view. The underlying
  snapshot mechanism is nonetheless reused today, but only as a **service
  batch surface** (`buildSnapshot` / `statusWithSnapshot`) behind the
  cognition-link enricher — never as a model-facing tool.
- No `coggit_routes` (flat route index of tracked pairs) — redundant with the
  host `any_routes` tool for navigation.

If either is needed again, restore from git history (they were deleted, not
commented — the pre-removal commit `0c2c0aa` still carries their
implementations).

## Layout

This directory is a standalone pnpm project inside the coggit repository
(`adapters/dsh`): it is NOT part of the root pnpm workspace (`packages/*`
stays pure-registry and clean-machine green); it owns its install, lockfile,
and host resolution layer. It is installed into a profile with
`dsh plugin add <path>` (bare path = `link:` symlink).

Dependency faces (asymmetric by rule):

- **Host face (runtime + types)** — every `@deepseek-ai/*` import is a
  **peerDependency** provided by the dsh host; `autoInstallPeers` stays off
  (the host's prerelease closure deadlocks registry resolution). Dev-time
  resolution is one machine-local, uncommitted **scope junction**
  `node_modules/@deepseek-ai` → `~/.dsh/profiles/node_modules/@deepseek-ai`
  (the host-maintained install closure — this package is an installed-closure
  consumer, not a source consumer). Rebuild: `pnpm --dir . relink`. A bare
  `pnpm install` purges the junction — always re-run `relink` after install.
- **Library face** — `@coggit/core` + `@coggit/runtime-node` as registry
  versions (`^0.2.0`, installed from npm; no `link:` into `../../packages/*`).
  `@catheadowl/dsh-extras` and dev-only `@catheadowl/dsh-eval` are registry
  versions too.
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

The normalized layout is documented in the `eval/README.md` file in this directory (not shipped in the npm tarball): behavior cases live under `eval/behavior/{real,mock}/`, while the separate `eval/comprehension/` experiment keeps frozen raw inputs, a blind prompt, and a hidden rubric. Generated artifacts stay under nearby `.runs/` directories. A rebuilt `lib/` is required first (`pnpm --dir . build`).

## What still needs a dsh profile (rare)

The suite covers every layer up to — but not including — a real Cordis boot: resolving `inject`, `cordis.patch.yml` composition, and profile config. Those matter only when the *structural* surface changes (tool names, `inject`, `Config`, the patch file, plugin name) and are verified by a one-shot headless boot, not a long-lived web server (see the dsh plugin-dev handbook's debug topic, Part 6, in the dsh-extra repository). Routine business-logic and tool-surface edits do not reach this layer.
