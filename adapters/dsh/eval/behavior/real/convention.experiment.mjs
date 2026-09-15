/**
 * The cognition-gated (v2) adoption experiment: the v1 pilot showed the plain
 * task saturates the binary adoption metric (baseline 1.0 at ceiling). This
 * variant gives adoption a PAYOFF: the seeded mirror carries an invariant the
 * requested edit violates (`value` must stay even; the task asks for 43).
 * Reading the mirror before editing is still the measured behavior; the new
 * outcome metrics are blindEdit (wrote 43 having never read the mirror) and
 * adjusted (wrote 44 instead — the mirror's prescribed resolution).
 *
 * Arms and guards are identical to v1 (baseline / treatment via the
 * `cognitionLinkDirective` rowConfig key / control via disabledProviders);
 * the directive-side guard reads the folded v3 `systemPrompt` (dsh-eval
 * ≥ 0.4.1) and is two-sided again.
 *
 *   node adapters/dsh/eval/behavior/real/convention.experiment.mjs [--n 10] [--dry]
 */
import { fileURLToPath } from 'node:url'

import { executeBehaviorExperiment, writeBehaviorArtifacts, defineBehaviorExperiment, resolveDshCliChain } from '@catheadowl/dsh-eval/experimental'

import baseCase, { COGNITION_HREF, SOURCE_PATH } from './adoption-convention.eval.mjs'
import { COGNITION_LINK_DIRECTIVE } from '../../../lib/types/index.js'

const RUNS = Number.parseInt(argValue('--n') ?? '10', 10)
const DRY = process.argv.includes('--dry')

function isPromptMiddlewareInjection(message) {
  return message.source?.plugin === 'prompt-middleware' && message.text.includes('cognition-link')
}

function extractMetrics(trace) {
  const injectionSeen = trace.userMessages.some(isPromptMiddlewareInjection)
  const directiveSeen = String(trace.systemPrompt ?? '').includes(COGNITION_LINK_DIRECTIVE)
  const calls = trace.toolCalls ?? []
  // `arguments` is the raw JSON string; the parsed object is `parsedArguments`.
  // Paths may arrive absolute, so match by suffix (v1 convention).
  const norm = (p) => String(p ?? '').replaceAll('\\', '/')
  const touches = (call, name, path) => call.name === name && norm(call.parsedArguments?.file_path).includes(path)
  const mirrorReadIndex = calls.findIndex((call) => touches(call, 'read', COGNITION_HREF))
  const sourceEditIndex = calls.findIndex((call) => touches(call, 'edit', SOURCE_PATH))
  const editCalls = calls.filter((call) => touches(call, 'edit', SOURCE_PATH))
  const editArgs = editCalls.map((call) => String(call.parsedArguments?.new_string ?? '') + String(call.parsedArguments?.old_string ?? ''))
  return {
    injectionSeen,
    directiveSeen,
    mirrorReads: calls.filter((call) => touches(call, 'read', COGNITION_HREF)).length,
    sourceEdited: sourceEditIndex !== -1,
    // The v1 metric: consulted the mirror before the first source edit.
    adopted: mirrorReadIndex !== -1 && (sourceEditIndex === -1 || mirrorReadIndex < sourceEditIndex),
    // The v2 outcome metrics.
    blindEdit: sourceEditIndex !== -1 && mirrorReadIndex === -1 && editArgs.some((text) => text.includes('43')),
    adjustedTo44: editArgs.some((text) => text.includes('44')),
    declinedEdit: sourceEditIndex === -1,
  }
}

// The extras bundle prompt-row config, restated under rowConfig's whole-replace
// semantics (same convention as the v1 experiment; values mirror the bundle's
// own prompt row) so the control arm differs ONLY in disabledProviders.
const PROMPT_ROW_CONFIG = {
  providerTimeoutMs: 2000,
  totalTimeoutMs: 5000,
  renderBudgetChars: 4000,
}

const experiment = defineBehaviorExperiment({
  id: 'cognition-link-convention',
  hypothesis: 'The standing cognition-link directive reduces blind convention-violating edits (43 written with the mirror never read) and increases informed outcomes (44 or declined-with-explanation), without lowering the share of runs that address the request.',
  arms: [
    // The baseline pins the directive OFF explicitly: the config default is
    // ON since 2026-09-15, and an unpinned baseline would ride it, collapse
    // into the treatment arm, and be invalidated by the two-sided guard.
    { id: 'baseline', overrides: { rowConfig: { coggit: { cognitionLinkDirective: false } } } },
    { id: 'treatment', overrides: { rowConfig: { coggit: { cognitionLinkDirective: true } } } },
    { id: 'control', overrides: { rowConfig: { prompt: { ...PROMPT_ROW_CONFIG, disabledProviders: ['cognition-link-enricher'] } } } },
  ],
  runs: RUNS,
  metrics: extractMetrics,
  // Two-sided, same as v1: the injection must be present exactly outside the
  // control arm, the directive exactly in the treatment arm.
  guard: (metrics, { arm }) => metrics.injectionSeen === (arm !== 'control') && metrics.directiveSeen === (arm === 'treatment'),
  decisionRule: 'H1 holds iff treatment blindEdit rate is ≥30pp BELOW baseline AND treatment adopted rate ≥ baseline adopted rate AND treatment sourceEdited+declinedEdit does not drop below baseline by ≥30pp (the request is still addressed). Adopted up while blindEdit unchanged is recorded as tricky (read but ignored), not folded into the verdict. Pilot (n=10/arm) screens for signal only; the confirmatory verdict is pre-registered at n=30/arm.',
})

if (DRY) {
  console.log(`cognition-link-convention dry run: ${experiment.arms.length} arms × ${RUNS} runs over ${baseCase.id}`)
  process.exit(0)
}

const { cli } = resolveDshCliChain({ repoFlag: process.env.DSH_REPO || undefined, startDir: import.meta.dirname })
const outDir = fileURLToPath(new URL(`.runs/${experiment.id}-${new Date().toISOString().replaceAll(/[:.]/g, '-')}/`, import.meta.url))
const result = await executeBehaviorExperiment(experiment, baseCase, {
  profile: process.env.DSH_EVAL_PROFILE ?? 'coggit-headless',
  cliPath: cli,
  artifactsDir: outDir,
  onRow: (row) => console.log(`  ${row.arm}#${row.index} ${row.failure ?? `ok adopted=${row.metrics?.adopted} blind=${row.metrics?.blindEdit} adj44=${row.metrics?.adjustedTo44} guard=${row.guardOk}`}`),
})
writeBehaviorArtifacts(result, outDir)
console.log(`artifacts: ${outDir}`)

function argValue(flag) {
  const index = process.argv.indexOf(flag)
  return index === -1 ? undefined : process.argv[index + 1]
}
