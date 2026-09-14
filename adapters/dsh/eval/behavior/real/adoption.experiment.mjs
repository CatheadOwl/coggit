/**
 * The cognition-link adoption experiment: three arms over
 * adoption-before-edit.eval.mjs, measuring whether the standing directive
 * (the `coggit:cognition-link` section) moves the model from "sees the link"
 * to "reads the paired cognition before editing".
 *
 *   baseline   — current surface (minimal overview, bare injection lines);
 *                this is the frozen failure baseline: the arm that must lose.
 *   treatment  — same surface + the directive (rowConfig flips the
 *                `coggit` row's `cognitionLinkDirective` config key).
 *   control    — provider disabled (`prompt` row's `disabledProviders`), the
 *                mechanism-absent arm; it isolates "injection presence" from
 *                "copy strength" (baseline−control = mechanism, treatment−
 *                baseline = copy).
 *
 * Guard: the injection must be PRESENT in baseline/treatment runs and ABSENT
 * in control runs — a leak fakes a treatment effect, a silent delivery
 * failure fakes a null result. The framework enforces this per run and marks
 * a zero-guard-clean arm INVALID.
 *
 * Requires the behavior-experiment surface (dsh-eval ADR 0006 / EVAL-023,
 * `@catheadowl/dsh-eval/experimental` — no compat promise until published;
 * the pinned devDep must be bumped past that release first). Run host-side
 * (credential + spawn capability):
 *
 *   node adapters/dsh/eval/behavior/real/adoption.experiment.mjs [--n 10] [--dry]
 */
import { fileURLToPath } from 'node:url'

import baseCase, { COGNITION_HREF, SOURCE_PATH } from './adoption-before-edit.eval.mjs'
import { COGNITION_LINK_DIRECTIVE } from '../../../lib/types/index.js'

// The experiment surface rides the experimental entry (no compat promise
// until the release carrying it ships; 0.3.0 has the entry but not these
// symbols). Fail with a pointer instead of a bare TypeError while the
// installed release predates the surface.
const { executeBehaviorExperiment, writeBehaviorArtifacts, defineBehaviorExperiment, resolveDshCliChain } = await import('@catheadowl/dsh-eval/experimental').then(
  (experimental) => experimental,
  () => ({}),
)
if (typeof defineBehaviorExperiment !== 'function') {
  console.error('adoption.experiment: this @catheadowl/dsh-eval release does not carry the behavior-experiment surface (experimental entry, dsh-extra ADR 0006 / EVAL-023). Upgrade the devDependency once that release ships.')
  process.exit(1)
}

// Pre-registered sample size. Pilot = 10/arm (signal check only); the
// confirmatory re-registers 30/arm — at α=0.05, power≈0.8 that detects an
// absolute ≥30pp shift in the binary adoption rate, which the decision rule
// declares the minimum operationally relevant effect.
const RUNS = Number.parseInt(argValue('--n') ?? '10', 10)
const DRY = process.argv.includes('--dry')

function isPromptMiddlewareInjection(message) {
  return message.source?.plugin === 'prompt-middleware' && message.text.includes('cognition-link')
}

function extractMetrics(trace) {
  const injectionSeen = trace.userMessages.some(isPromptMiddlewareInjection)
  // The treatment's surface variant must actually reach the assembled system
  // prompt — a config key the installed plugin silently ignores would fake a
  // no-effect treatment. The host (0.1.5-rc.2, format v3) does not persist
  // the system prompt into `request/header` (census records the vacancy as
  // `headerWithoutSystem`), so this is measured ONLY when the channel exists;
  // `null` marks the vacant channel and the guard degrades to delivery-only.
  // The config→section hop itself is unit-verified (shape-and-views tests).
  const headers = trace.requestHeaders ?? []
  const systemChannelLive = headers.some((header) => typeof header.system === 'string' && header.system !== '')
  const directiveSeen = systemChannelLive
    ? headers.some((header) => String(header.system).includes(COGNITION_LINK_DIRECTIVE))
    : null
  const calls = trace.toolCalls ?? []
  // `arguments` is the raw JSON string; the parsed object is `parsedArguments`
  // (EvalTrace contract). Paths may arrive absolute, so match by suffix, the
  // same convention the relates A/B metrics use.
  const isMirrorRead = (call) => call.name === 'read' && String(call.parsedArguments?.file_path ?? '').replaceAll('\\', '/').includes(COGNITION_HREF)
  const isSourceEdit = (call) => call.name === 'edit' && String(call.parsedArguments?.file_path ?? '').replaceAll('\\', '/').includes(SOURCE_PATH)
  const firstIndex = (predicate) => calls.findIndex(predicate)
  const mirrorReadIndex = firstIndex(isMirrorRead)
  const sourceEditIndex = firstIndex(isSourceEdit)
  return {
    injectionSeen,
    directiveSeen,
    mirrorReads: calls.filter(isMirrorRead).length,
    sourceEdited: sourceEditIndex !== -1,
    // The primary metric: a cognition read happens at all AND precedes the
    // first source edit (−1 means "not before", including "never").
    adopted: mirrorReadIndex !== -1 && (sourceEditIndex === -1 || mirrorReadIndex < sourceEditIndex),
  }
}

// The extras bundle prompt-row config, restated under rowConfig's whole-replace
// semantics (same convention as the relates A/B control arm; values mirror the
// bundle's own prompt row) so the control arm differs ONLY in disabledProviders.
const PROMPT_ROW_CONFIG = {
  providerTimeoutMs: 2000,
  totalTimeoutMs: 5000,
  renderBudgetChars: 4000,
}

const experiment = defineBehaviorExperiment({
  id: 'cognition-link-adoption',
  hypothesis: 'The standing cognition-link directive raises the rate at which the model reads the paired cognition document before editing the mentioned source file, without lowering task completion.',
  arms: [
    { id: 'baseline' },
    { id: 'treatment', overrides: { rowConfig: { coggit: { cognitionLinkDirective: true } } } },
    { id: 'control', overrides: { rowConfig: { prompt: { ...PROMPT_ROW_CONFIG, disabledProviders: ['cognition-link-enricher'] } } } },
  ],
  runs: RUNS,
  metrics: extractMetrics,
  // Guard, two-sided when measurable: the injection must be present exactly
  // outside the control arm, AND the directive exactly in the treatment arm.
  // `directiveSeen === null` (system-prompt channel vacant on this host)
  // degrades that side to delivery-only; a leaked directive into baseline
  // still fakes a null copy effect when the channel is live.
  guard: (metrics, { arm }) => metrics.injectionSeen === (arm !== 'control')
    && (metrics.directiveSeen === null || metrics.directiveSeen === (arm === 'treatment')),
  decisionRule: 'H1 holds iff treatment adoption rate exceeds baseline by ≥30pp absolute AND control adoption ≤ baseline AND sourceEdited rate does not drop in treatment vs baseline. Adoption up while sourceEdited down is recorded as tricky, not folded into the verdict. Pilot (n=10/arm) screens for signal only; the confirmatory verdict is pre-registered at n=30/arm.',
})

if (DRY) {
  console.log(`cognition-link-adoption dry run: ${experiment.arms.length} arms × ${RUNS} runs over ${baseCase.id}`)
  process.exit(0)
}

const { cli } = resolveDshCliChain({ repoFlag: process.env.DSH_REPO || undefined, startDir: import.meta.dirname })
const outDir = fileURLToPath(new URL(`.runs/${experiment.id}-${new Date().toISOString().replaceAll(/[:.]/g, '-')}/`, import.meta.url))
const result = await executeBehaviorExperiment(experiment, baseCase, {
  profile: process.env.DSH_EVAL_PROFILE ?? 'coggit-headless',
  cliPath: cli,
  artifactsDir: outDir,
  onRow: (row) => console.log(`  ${row.arm}#${row.index} ${row.failure ?? `ok adopted=${row.metrics?.adopted} inj=${row.metrics?.injectionSeen} dir=${row.metrics?.directiveSeen} guard=${row.guardOk}`}`),
})
writeBehaviorArtifacts(result, outDir)
console.log(`artifacts: ${outDir}`)

function argValue(flag) {
  const index = process.argv.indexOf(flag)
  return index === -1 ? undefined : process.argv[index + 1]
}
