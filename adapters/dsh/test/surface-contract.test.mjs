// Surface-contract tests (L1): token-level stitching invariants of the
// model-visible prompt surface, checked WITHOUT a model. The contract:
// whatever standing text ships must (a) contain the injection-line marker
// token the renderer emits, (b) mention every meta token the renderer can
// append — otherwise the rendered `[cognition-link]` lines are undefined
// symbols the model can see but not act on.
//
// Two fixtures anchor both directions:
// - the frozen baseline (the current `minimal` surface, directive off) is the
//   KNOWN-BAD failure baseline — the checker MUST report exactly its known
//   findings; a checker that passes it is broken (negative-control self-test);
// - the directive surface (`COGNITION_LINK_DIRECTIVE`) is the treatment face —
//   zero findings is its contract.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { getCoggitSystemPrompt } from '@coggit/core'

import { fromLib } from './helpers.mjs'

const { COGNITION_LINK_DIRECTIVE } = await import(fromLib('index'))

const INJECTION_MARKER = 'cognition-link'
const RENDERED_META_TOKENS = ['stale', 'updated']

/**
 * Token-level stitching findings for one standing prompt text. Exported for
 * reuse by future surface fixtures; findings are stable machine-readable ids.
 */
export function surfaceContractFindings(text) {
  const findings = []
  if (!text.includes(INJECTION_MARKER)) findings.push(`marker-token-missing:${INJECTION_MARKER}`)
  for (const token of RENDERED_META_TOKENS) {
    if (!text.includes(`(${token}`)) findings.push(`meta-token-undefined:(${token})`)
  }
  return findings
}

// Byte-frozen at the failure-baseline capture (the probe-era surface); re-captured
// deliberately on 2026-10-07 for the paired-document terminology canonicalization
// ("cognition document" everywhere), again the same day for the wording-candidates
// round (folder mirror path made explicit: "the README.md at its mirrored path"),
// and on 2026-11-15 for the paste-once invariant-block contract: minimal
// is re-derived from the standard segment table (mirror / records / snapshot /
// upkeep + the use-it connective), trading the short hint for the invariant duties
// the pasted block must carry.
// This is the frozen arm of the A/B: if `minimal` ever changes again, this assertion
// fires and the baseline fixture here must be re-captured deliberately.
const FROZEN_MINIMAL = "CogGit cognition is a mirrored design layer over the source tree: a file's cognition document is the design counterpart of the same source-relative path with `.md` appended (`src/foo.ts` pairs with `src/foo.ts.md`), and a folder's cognition document is the README.md at that folder's mirrored path.\nUse it to explore the codebase.\nCogGit cognition documents record design intent, contracts, boundaries, and invariants, not implementation summaries.\nBefore reading source code in a project configured for CogGit, locate the relevant cognition document — via per-path status or the mirror convention — and inspect it when it can inform the task.\nWhen changing code in a project configured for CogGit, keep the paired cognition document up to date."

test('frozen baseline: minimal form is byte-stable', () => {
  assert.equal(getCoggitSystemPrompt('minimal').content, FROZEN_MINIMAL)
})

test('frozen baseline reports exactly the known findings (checker self-test)', () => {
  assert.deepEqual(surfaceContractFindings(FROZEN_MINIMAL), [
    'marker-token-missing:cognition-link',
    'meta-token-undefined:(stale)',
    'meta-token-undefined:(updated)',
  ])
})

test('directive surface has zero findings', () => {
  assert.deepEqual(surfaceContractFindings(COGNITION_LINK_DIRECTIVE), [])
})

test('directive uses the canonical paired-document vocabulary', () => {
  assert.match(COGNITION_LINK_DIRECTIVE, /cognition document/)
  assert.doesNotMatch(COGNITION_LINK_DIRECTIVE, /design note|cognition files/)
})

test('directive carries the accounted-deviation phrase (ladder-2 signature)', () => {
  assert.match(COGNITION_LINK_DIRECTIVE, /say why in one line/)
})
