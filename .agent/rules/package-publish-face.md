---
description: npm publish-face rules seed — expected shape of the published @coggit/* / coggit packages; consumed by writing (advisory via AGENTS.md) and by SDK-face reviews (embedded verbatim, findings cite PKG-n ids).
---

# Package publish-face rules

Rules SSOT seed for the npm publish face (`coggit`, `@coggit/core`,
`@coggit/runtime-node`, `@coggit/mcp`; `@coggit/format` and
`@coggit/mcp-runtime-support` are private). Probes are mechanical arms —
violations are prefixed with the rule id. Ids never renumber once cited; a
semantic change retires the id and issues a new one.

- **PKG-1〈deps-external〉**: every `dependencies` entry of a published package is external in its `build.js`. Probe: `node scripts/verify-publish-face.mjs`. Baseline: should-fix.
- **PKG-2〈reachable-types-declared〉**: every bare import in a `.d.ts` reachable from `exports` type entries is declared in dependencies/peerDependencies. Probe: `node scripts/verify-publish-face.mjs`. Baseline: blocker.
- **PKG-3〈native-external-and-declared〉**: native-binding deps are external and declared runtime dependencies. Probe: `node scripts/verify-publish-face.mjs` (PKG-1 arm). Baseline: should-fix.
- **PKG-4〈publish-via-pnpm〉**: publishing uses `pnpm publish`, never `npm publish`. Probe: none. Baseline: should-fix.
- **PKG-5〈per-package-readme〉**: every published package ships a package-root `README.md`. Probe: `node scripts/verify-publish-face.mjs`. Baseline: should-fix.
- **PKG-6〈exports-resolve〉**: every exports/main/types/bin target exists in the built package. Probe: `node scripts/verify-publish-face.mjs` (run after build). Baseline: blocker.
- **PKG-7〈version-single-source〉**: no hardcoded semver literals in shipped sources; versions come from build-time injection. Probe: `node scripts/verify-publish-face.mjs`. Baseline: nit.

## intentional-design exemptions

- `./internal` subpaths are published on purpose (the published `coggit` CLI consumes them at runtime); no stability promise to third parties.
- The `coggit` CLI's `dist/mcp-stdio.js` bundles everything — exemption to PKG-1 (launcher copies it outside any `@coggit/*` install).
- CJS-only output for v1.
- `@coggit/format` / `@coggit/mcp-runtime-support` are private and bundled into consumers.
- `@coggit/mcp` bundles the MCP SDK and zod at runtime; only type leaks (PKG-2) are findings.
