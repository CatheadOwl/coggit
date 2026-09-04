---
description: npm publish face rules seed — expected shape of the published @coggit/* / coggit packages; consumed by writing (advisory) and by SDK-face reviews (embedded verbatim, findings cite PKG-n ids).
---

# Package publish-face rules

Rules SSOT seed for the npm publish face (packages `coggit`, `@coggit/core`,
`@coggit/runtime-node`, `@coggit/mcp`; `@coggit/format` and
`@coggit/mcp-runtime-support` are private). Dual consumption: writing-time
(advisory, loaded via the `AGENTS.md` pointer) and review-time (SDK-face
review dispatch prompts embed this file verbatim; findings cite rule ids).
Rules state only the expected shape; rationale lives in the cognition layer /
decision history. Ids never renumber once cited; a semantic change retires the
id and issues a new one; retired ids are marked "deprecated", never reused.

- **PKG-1〈external-published-deps〉**: Published runtime dependencies
  (`@coggit/core`, `@coggit/runtime-node`, their `/internal` subpaths) stay
  external in every esbuild bundle of an npm-published package — single
  semantic source of truth. Probe: read the `external` array in
  `packages/{core,runtime-node,mcp,cli}/build.js`. Baseline: should-fix.
- **PKG-2〈bundled-types-not-leaked〉**: No dependency that is a devDependency
  (i.e. bundled into `dist`) may appear in an import line of any published
  `.d.ts`; public type surface must resolve from the package's declared
  dependencies alone. Probe:
  `grep -rE "from '(zod|@modelcontextprotocol[^']*|commander|yaml)'" packages/*/dist --include=*.d.ts`
  (empty output = pass). Baseline: blocker.
- **PKG-3〈native-deps-external-and-declared〉**: Native-binding dependencies
  (`@parcel/watcher`) stay external in bundles AND are declared runtime
  dependencies of the package whose code reaches them. Probe: `external` array
  in `packages/{runtime-node,cli}/build.js` + `dependencies` in
  `packages/runtime-node/package.json`. Baseline: should-fix.
- **PKG-4〈publish-via-pnpm〉**: `workspace:*` protocol dependencies require
  publishing through `pnpm publish` (never `npm publish`, which ships the
  literal `workspace:*` and breaks installs). Probe: none. Baseline:
  should-fix.
- **PKG-5〈per-package-readme〉**: Every npm-published package has its own
  `README.md` shipped in the tarball (one-line positioning, minimal usage
  example, link to the repo root docs; private packages exempt). Probe:
  `Test-Path packages/{core,runtime-node,mcp,cli}/README.md`. Baseline:
  should-fix.
- **PKG-6〈exports-mirror-dist〉**: Every `exports`/`main`/`types`/`bin` target
  in a published `package.json` exists in `dist` after build, and `files`
  covers all shipped artifacts. Probe:
  `pnpm -r run build` then resolve each target path. Baseline: blocker when a
  target is missing.
- **PKG-7〈version-single-source〉**: Shipped artifacts report the package
  version via build-time injection (e.g. `__COGGIT_PACKAGE_VERSION__` define),
  never hardcoded version literals in source. Probe:
  `grep -rnE "version: '[0-9]+\.[0-9]+" packages/*/src --include=*.ts`
  (should only hit injected constants). Baseline: nit.

## intentional-design exemptions (cite this list to dismiss a finding)

Reviewers: the following are deliberate design, not defects —

- **`./internal` subpaths are published on purpose**: `@coggit/core/internal`
  and `@coggit/runtime-node/internal` are consumed at runtime by the published
  `coggit` CLI (see `external` in `packages/cli/build.js`); they are a
  trusted-consumer face with no stability promise — publishing them is
  correct, third-party use is merely discouraged.
- **`coggit` CLI's `dist/mcp-stdio.js` bundles everything** (`@coggit/mcp`,
  `@coggit/core`, `@coggit/runtime-node`): it is copied by the launcher to
  `~/.coggit/runtimes/...` where no `@coggit/*` are installed — an explicit
  exemption to PKG-1.
- **CJS-only output**: bundles are CommonJS with no ESM condition; Node-first
  consumers only, by design for v1.
- **Private packages bundled into consumers**: `@coggit/format` and
  `@coggit/mcp-runtime-support` are `private: true` and inlined — never
  expected on npm.
- **`@coggit/mcp` bundles the MCP SDK and zod at runtime**: the code size /
  single-tarball tradeoff is intentional; only the *type leak* (PKG-2) is a
  finding, not the bundling itself.
