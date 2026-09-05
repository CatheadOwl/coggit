---
description: Marketplace listing surface rules — local override declaring that packages/vscode/README.md is governed by Marketplace listing conventions, not the npm publish-face rules (PKG-5/8/9 n/a).
---

# Marketplace listing surface (packages/vscode)

`packages/vscode/README.md` is the VS Code Marketplace listing surface, not an
npm distribution face. It is rendered by the Marketplace store page, so the
npm-package consumption assumptions behind the inherited publish-face rules do
not hold here.

SCOPE-OVERRIDE (registered exceptions to inherited rules; rationale recorded
per the surface ownership matrix):

- **PKG-8 n/a** — a Marketplace listing has no install-line/API-example
  consumption shape; its content follows the repo's README narrative policy,
  wording constraints, and Marketplace listing conventions.
- **PKG-9 n/a** — the extension package has no grep-able public exports face
  (`src/public.ts`); the probe has nothing to execute against.
- **RDF-9 (no embedded CHANGELOG) n/a** — Marketplace conventions allow
  release-notes content on the listing when the extension publishes changelog
  notes there.

This file is a thin pointer (no rationale restated): the ownership matrix in
the README writing policy is the single judgment home for who governs which
README surface.
