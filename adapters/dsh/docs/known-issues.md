---
description: Known issues — eval assertions hardcode the source.plugin literal (convergence candidate, not a defect)
---

# Known issues

## Eval assertions hardcode the `source.plugin` literal (convergence candidate, not a defect)

**Today**: arrival assertions of the form `source?.plugin === '…'` are scattered
across 7+ sites (three real experiments, two mock evals, the composition
regression, `scripts/wild-glance-rate.mjs`) — the plugin name is hardcoded at
each site. The brand word has already changed twice (`any_routes` → `any_nav`,
`prompt-middleware` → `enrichment` in the 2026-09-22 upstream engine-word
rename), and each rename costs a mechanical sweep proportional to the
assertion count.

**Suggestion**: converge the plugin-source token into a single constant (one
definition site, assertions reference it); anchor "the injection arrived" on
the frozen envelope vocabulary (`relates:` + `[kind]` — frozen by the upstream
carrier's rename decision), keeping the plugin name literal in exactly one
place.

**Tracking**: delete this entry when the convergence lands.
