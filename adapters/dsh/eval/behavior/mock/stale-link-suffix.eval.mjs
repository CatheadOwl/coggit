/**
 * Deterministic stale-suffix case: a pre-staled cognition pair (out-of-band
 * source rewrite in the fixture) + one scripted read through the REAL tool
 * pipeline, asserting the model-visible rendering of the cognition-link meta
 * annotation channel end to end:
 *
 * - the single enrichment injection mentions the paired cognition href
 *   AND carries the `(stale)` suffix (provider writes the key only when
 *   stale; enrichment renders item meta as the line suffix);
 * - the suffix uses the boolean-flag short form `(stale)`, not `(stale=true)`.
 *
 * Companion of touch-lane-roundtrip (never→fresh, bare line). The `updated`
 * flip marker stays out of scope here: it needs a mid-run external mutation
 * between tool steps, which a static script cannot express (unit-tested in
 * test/cognition-link-provider.test.mjs instead).
 */
import {
  firstTool,
  finalTextIncludes,
  toolCallStep,
  textStep,
} from '@catheadowl/dsh-eval'
import { seedProject, seedStaleCognition } from '../_fixtures/seed-project.mjs'

const COGNITION_HREF = 'src_cognition/example.ts.md'
const ENRICHMENT = 'enrichment'

function staleSuffixInjectedOnce(trace) {
  const injections = trace.userMessages
    .filter(message => message.source?.plugin === ENRICHMENT)
    .filter(message => message.text.includes(COGNITION_HREF))
  if (injections.length !== 1) {
    return {
      ok: false,
      message: `expected exactly 1 ${ENRICHMENT} injection mentioning ${COGNITION_HREF}, saw ${injections.length}`,
    }
  }
  const short = injections.filter(message =>
    message.text.includes(`${COGNITION_HREF} (stale)`) && !message.text.includes('(stale=true)'))
  if (short.length !== 1) {
    return {
      ok: false,
      message: `expected the injection to carry the short-form "(stale)" suffix after the href, saw: ${JSON.stringify(injections.map(message => message.text))}`,
    }
  }
  return { ok: true, message: '' }
}

export default {
  id: 'coggit-mock-stale-link-suffix',
  mode: 'mock',
  task: 'eval driver: scripted stale cognition-link suffix',
  async prepare(workspace) {
    await seedProject(workspace)
    await seedStaleCognition(workspace)
  },
  script: {
    steps: [
      toolCallStep('read', { file_path: 'src/example.ts' }),
      textStep('Mock stale link suffix complete.'),
    ],
  },
  expect: [
    firstTool('read'),
    {
      describe: `exactly one ${ENRICHMENT} injection carries "(stale)" after the cognition href`,
      check: staleSuffixInjectedOnce,
    },
    finalTextIncludes('Mock stale link suffix complete.'),
  ],
}
