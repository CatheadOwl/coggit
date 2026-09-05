---
description: npm publish-face rules seed — expected shape of the published @coggit/* packages; consumed by writing (advisory via AGENTS.md) and by SDK-face reviews (embedded verbatim, findings cite PKG-n ids).
---

# Package publish-face rules

Rules SSOT seed for the npm publish face (`@coggit/cli`, `@coggit/core`,
`@coggit/runtime-node`, `@coggit/mcp`; `@coggit/format` and
`@coggit/mcp-runtime-support` are private). Scope: this file governs the
npm-distributed packages under `packages/` (tree-positioned scope, cascade
semantics); `packages/vscode/README.md` is a Marketplace listing surface and
is exempt from PKG-5/8/9 — see its local override
`packages/vscode/.agent/rules/marketplace-listing.md`. Probes are mechanical
arms — violations are prefixed with the rule id. Ids never renumber once
cited; a semantic change retires the id and issues a new one.

- **PKG-1〈deps-external〉**: every `dependencies` entry of a published package is external in its `build.js`. Probe: `node scripts/verify-publish-face.mjs`. Baseline: should-fix.
- **PKG-2〈reachable-types-declared〉**: every bare import in a `.d.ts` reachable from `exports` type entries is declared in dependencies/peerDependencies. Probe: `node scripts/verify-publish-face.mjs`. Baseline: blocker.
- **PKG-3〈native-external-and-declared〉**: native-binding deps are external and declared runtime dependencies. Probe: `node scripts/verify-publish-face.mjs` (PKG-1 arm). Baseline: should-fix.
- **PKG-4〈publish-via-pnpm〉**: publishing uses `pnpm publish`, never `npm publish`. Probe: none. Baseline: should-fix.
- **PKG-5〈per-package-readme〉**: every published package ships a package-root `README.md`. Probe: `node scripts/verify-publish-face.mjs`. Baseline: should-fix.
- **PKG-6〈exports-resolve〉**: every exports/main/types/bin target exists in the built package. Probe: `node scripts/verify-publish-face.mjs` (run after build). Baseline: blocker.
- **PKG-7〈version-single-source〉**: no hardcoded semver literals in shipped sources; versions come from build-time injection. Probe: `node scripts/verify-publish-face.mjs`. Baseline: nit.
- **PKG-8〈package-readme-content〉**: every published package-root `README.md` follows the per-package content contract — one-line positioning (reuse the `package.json` description), install line, a minimal usage example, an SSOT link to the repo root README / docs instead of restating architecture, and (for `@coggit/core` / `@coggit/runtime-node`) a note that the `./internal` subpath is a trusted-consumer face with no stability promise. Probe: review of each published package README (human). Baseline: should-fix.
- **PKG-9〈readme-example-matches-exports〉**: named imports and call shapes shown in a published package README must match the actual public exports — signature tokens must be grep-able in the package's public surface (e.g. `packages/*/src/public.ts`). Example API drift (calls to exports that do not exist or with a wrong signature) is a blocker because the README example is the first consumer contract. Probe: `node scripts/verify-publish-face.mjs` (named-imports arm; packages without `src/public.ts` are probe n/a). Baseline: blocker.

## intentional-design exemptions

- `./internal` subpaths are published on purpose (the published `@coggit/cli` consumes them at runtime); no stability promise to third parties.
- The `@coggit/cli`'s `dist/mcp-stdio.js` bundles everything — exemption to PKG-1 (launcher copies it outside any `@coggit/*` install).
- CJS-only output for v1.
- `@coggit/format` / `@coggit/mcp-runtime-support` are private and bundled into consumers.
- `@coggit/mcp` bundles the MCP SDK and zod at runtime; only type leaks (PKG-2) are findings.
