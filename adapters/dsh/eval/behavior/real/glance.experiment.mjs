/**
 * The noise-salience glance experiment (round 3): the two saturated pilots
 * (adoption flat, convention-gated) showed ceiling on single-file workspaces —
 * baseline glanced 10/10 — so they could not rank copy. The wild gap the
 * original probe measured (links delivered, mirrors unread) lives in
 * competition: many files, multi-path prompts, several injected lines at once.
 * This experiment recreates that shape over glance-noise.eval.mjs and asks the
 * minimal-intent question only: does the model GLANCE at the target pair, and
 * early enough to matter — never whether it complies with anything the mirror
 * says. Confirmatory endpoint (pre-registered 2026-09-15, before the n=30
 * run): `earlyGlance` — the target-mirror read lands before the FIRST
 * target-source access; the before-edit glance rate saturated in all three
 * pilots and is a background read now.
 *
 *   baseline   — bare injection under noise (directive off): the arm whose
 *                ceiling-then-floor behavior decides whether the fixture has
 *                headroom at all.
 *   treatment  — same + the standing directive (rowConfig flips the `coggit`
 *                row's `cognitionLinkDirective` key). The directive text is
 *                projected LIVE from the built lib, so a genre-clause landing
 *                later re-measures its increment by re-running this file.
 *   control    — provider disabled; isolates injection presence from copy.
 *
 * Boundary (VP-6): competing NON-cognition injection lanes (e.g. breadcrumb
 * lines) would need host-profile work outside this repo; round 3 approximates
 * competition with multi-path cognition-link lines only.
 *
 * Guard: two-sided, identical to the adoption experiment — injection present
 * exactly outside control, directive exactly in treatment.
 *
 * Run host-side (credential + spawn):
 *   node adapters/dsh/eval/behavior/real/glance.experiment.mjs [--n 10] [--dry]
 */
import { fileURLToPath } from 'node:url'

import baseCase, { COGNITION_HREF, COGNITION_ROOT, SOURCE_PATH } from './glance-noise.eval.mjs'
import { COGNITION_LINK_DIRECTIVE } from '../../../lib/types/index.js'

const { executeBehaviorExperiment, writeBehaviorArtifacts, defineBehaviorExperiment, resolveDshCliChain } = await import('@catheadowl/dsh-eval/experimental').then(
  (experimental) => experimental,
  () => ({}),
)
if (typeof defineBehaviorExperiment !== 'function') {
  console.error('glance.experiment: this @catheadowl/dsh-eval release does not carry the behavior-experiment surface (experimental entry, dsh-extra ADR 0006 / EVAL-023). Upgrade the devDependency once that release ships.')
  process.exit(1)
}

// Pilot = 10/arm (signal + fixture-headroom check); confirmatory pre-registers
// 30/arm, same as the adoption experiment.
const RUNS = Number.parseInt(argValue('--n') ?? '10', 10)
const DRY = process.argv.includes('--dry')
// Optional single-arm rectification batch (see the arms comment below).
const ARM = argValue('--arm')

function isPromptMiddlewareInjection(message) {
  return message.source?.plugin === 'prompt-middleware' && message.text.includes('cognition-link')
}

function extractMetrics(trace) {
  const injectionSeen = trace.userMessages.some(isPromptMiddlewareInjection)
  const directiveSeen = String(trace.systemPrompt ?? '').includes(COGNITION_LINK_DIRECTIVE)
  const calls = trace.toolCalls ?? []
  const normalize = (value) => String(value ?? '').replaceAll('\\', '/')
  const isRead = (call) => call.name === 'read'
  const isTargetMirrorRead = (call) => isRead(call) && normalize(call.parsedArguments?.file_path).includes(COGNITION_HREF)
  const isAnyMirrorRead = (call) => isRead(call) && normalize(call.parsedArguments?.file_path).includes(`${COGNITION_ROOT}/`)
  const isTargetSourceRead = (call) => isRead(call) && normalize(call.parsedArguments?.file_path).includes(SOURCE_PATH)
  const isSourceEdit = (call) => call.name === 'edit' && normalize(call.parsedArguments?.file_path).includes(SOURCE_PATH)
  const isSourceAccess = (call) => isTargetSourceRead(call) || isSourceEdit(call)
  const firstIndex = (predicate) => calls.findIndex(predicate)
  const glanceIndex = firstIndex(isTargetMirrorRead)
  const sourceAccessIndex = firstIndex(isSourceAccess)
  const sourceEditIndex = firstIndex(isSourceEdit)
  return {
    injectionSeen,
    directiveSeen,
    // The CONFIRMATORY primary endpoint (pre-registered 2026-09-15): the
    // glance lands before the FIRST target-source access (read or edit) —
    // information gain exists only when the cognition arrives before
    // source-informed planning starts. The glance-before-edit rate saturated
    // in all three pilots and is demoted to a background read.
    earlyGlance: glanceIndex !== -1 && (sourceAccessIndex === -1 || glanceIndex < sourceAccessIndex),
    // Background reads: never decide.
    glanced: glanceIndex !== -1 && (sourceEditIndex === -1 || glanceIndex < sourceEditIndex),
    firstGlanceIndex: glanceIndex,
    // Over-compliance side signal: mirror reads that are NOT the target pair.
    distractorMirrorReads: calls.filter((call) => isAnyMirrorRead(call) && !isTargetMirrorRead(call)).length,
    sourceEdited: sourceEditIndex !== -1,
  }
}

// Whole-replace restatement of the prompt row's config (same convention and
// values as the adoption experiment) so the control arm differs ONLY in
// disabledProviders.
const PROMPT_ROW_CONFIG = {
  providerTimeoutMs: 2000,
  totalTimeoutMs: 5000,
  renderBudgetChars: 4000,
}

// Post-default-flip (2026-09-15) EVERY arm pins the coggit row: an unpinned
// arm rides the ON default, and the two-sided guard (directiveSeen ===
// (arm === 'treatment')) invalidates it — the first confirmatory run lost
// its whole control arm to exactly this.
const ALL_ARMS = [
  { id: 'baseline', overrides: { rowConfig: { coggit: { cognitionLinkDirective: false } } } },
  { id: 'treatment', overrides: { rowConfig: { coggit: { cognitionLinkDirective: true } } } },
  { id: 'control', overrides: { rowConfig: {
    coggit: { cognitionLinkDirective: false },
    prompt: { ...PROMPT_ROW_CONFIG, disabledProviders: ['cognition-link-enricher'] },
  } } },
]

const experiment = defineBehaviorExperiment({
  id: 'cognition-link-glance',
  hypothesis: 'Under multi-file, multi-path-injection noise, the standing cognition-link directive raises the rate at which the model glances at the target pair BEFORE ITS FIRST TARGET-SOURCE ACCESS (the confirmatory primary endpoint `earlyGlance`), without lowering task completion.',
  // `--arm <id>` re-runs one arm only (arms are independent host processes,
  // so a rectification batch is statistically identical in structure); used
  // to recover an arm invalidated by a definition bug without re-paying the
  // intact arms.
  arms: ALL_ARMS.filter((arm) => ARM === undefined || arm.id === ARM),
  runs: RUNS,
  metrics: extractMetrics,
  guard: (metrics, { arm }) => metrics.injectionSeen === (arm !== 'control') && metrics.directiveSeen === (arm === 'treatment'),
  decisionRule: 'Pre-registered 2026-09-15 for the confirmatory round (the glance-before-edit RATE saturated in all three pilots; the round-3 report promoted time-to-glance to primary). Primary endpoint: earlyGlance = target-mirror read before the first target-source access (read or edit). Fixture validity: if baseline earlyGlance rate = 1.0 there is no headroom and NO verdict — redesign the fixture; floor case (baseline 0 and treatment 0) is no-signal-under-noise, no verdict. H1 holds iff treatment earlyGlance rate exceeds baseline by ≥30pp absolute AND control earlyGlance ≤ baseline AND sourceEdited rate does not drop in treatment vs baseline. glanced (before-edit) and firstGlanceIndex stay background/directional, never decide. n=30/arm at α=0.05 targets detection of an absolute ≥30pp shift with power≈0.8.',
})

if (DRY) {
  console.log(`cognition-link-glance dry run: ${experiment.arms.length} arms × ${RUNS} runs over ${baseCase.id}`)
  process.exit(0)
}

const { cli } = resolveDshCliChain({ repoFlag: process.env.DSH_REPO || undefined, startDir: import.meta.dirname })
const outDir = fileURLToPath(new URL(`.runs/${experiment.id}-${new Date().toISOString().replaceAll(/[:.]/g, '-')}/`, import.meta.url))
const result = await executeBehaviorExperiment(experiment, baseCase, {
  profile: process.env.DSH_EVAL_PROFILE ?? 'coggit-headless',
  cliPath: cli,
  artifactsDir: outDir,
  onRow: (row) => console.log(`  ${row.arm}#${row.index} ${row.failure ?? `ok early=${row.metrics?.earlyGlance} glanced=${row.metrics?.glanced} at=${row.metrics?.firstGlanceIndex} distr=${row.metrics?.distractorMirrorReads} inj=${row.metrics?.injectionSeen} dir=${row.metrics?.directiveSeen} guard=${row.guardOk}`}`),
})
writeBehaviorArtifacts(result, outDir)
console.log(`artifacts: ${outDir}`)

function argValue(flag) {
  const index = process.argv.indexOf(flag)
  return index === -1 ? undefined : process.argv[index + 1]
}
