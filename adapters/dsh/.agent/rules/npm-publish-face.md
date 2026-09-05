---
description: npm publish-face rules seed for @coggit/dsh — adapter-scoped projection of the packages/ PKG seed; consumed by publish reviews of this tree, findings cite PKG-n ids.
---

# Adapter publish-face rules (dsh)

Rules seed for the npm publish face of `@coggit/dsh`
(`adapters/dsh`). Pulled from [the packages PKG seed](../../../../packages/.agent/rules/npm-publish-face.md)
(S5 of the publish-readiness spec); ids keep the PKG-n numbering so findings
stay citable across both trees. Scope: this directory (tree-positioned,
cascade semantics).

- **PKG-1〈deps-external〉**: n/a — the adapter ships tsc output, not bundles; `@coggit/*` and `@catheadowl/dsh-extras` are regular dependencies and stay external imports.
- **PKG-2〈reachable-types-declared〉**: every bare import in a `.d.ts` reachable from `exports` type entries is declared in dependencies/peerDependencies. Baseline: blocker.
- **PKG-4〈publish-via-pnpm〉**: publishing uses `pnpm publish --access public --no-git-checks`, never `npm publish`. Baseline: should-fix.
- **PKG-5〈per-package-readme〉**: the package ships a root `README.md` (npm auto-includes). Baseline: should-fix.
- **PKG-6〈exports-resolve〉**: every `exports` target exists in the built package — including `./client` (`lib/client.js`, a `build:client` tsdown artifact) and `lib/index.js` (legacy manifest-lookup artifact). Baseline: blocker.
- **PKG-8〈package-readme-content〉**: the README keeps a positioning line, an install line, and links only to paths shipped in the tarball (the `eval/` tree is dev-only — references must be plain text, not links). Baseline: should-fix.
- **PKG-9〈readme-example-matches-exports〉**: any usage example matches the actual public exports. Baseline: blocker.

Adapter-specific gates (from the publish-readiness spec, frozen 2026-09-06):

- The full artifact set (`lib/types`, `lib/client.js`, `lib/index.js`) must be
  built on the release machine (`DSH_REPO` anchor) before packing — CI cannot
  reproduce `build:client` (unpublished host preset).
- No `eval/`, `.runs/`, or `test/` content may leak into the tarball.
