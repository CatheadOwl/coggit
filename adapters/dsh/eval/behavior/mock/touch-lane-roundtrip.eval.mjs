/**
 * Deterministic touch-lane case: real seeded project + scripted read/read/edit
 * through the REAL tool pipeline, asserting the cognition-link enricher's
 * rendering discipline end to end (through prompt-middleware's runner, once
 * ledger, and render face — not a direct provider call like the unit tests):
 *
 * - read touch → exactly ONE prompt-middleware injection carrying the paired
 *   cognition href (never→fresh);
 * - the second read and the agent's own edit add nothing (steady-state
 *   silence + silent reconcile — the once ledger and lastRendered agree).
 *
 * Out of scope here (unit-tested in test/cognition-link-provider.test.mjs,
 * needs mid-run external mutation this static script cannot express): the
 * `updated` marker on state flips.
 */
import {
  firstTool,
  finalTextIncludes,
  toolCallStep,
  textStep,
} from '@catheadowl/dsh-eval'
import { seedProject, seedFreshCognition } from '../_fixtures/seed-project.mjs'

const COGNITION_HREF = 'src_cognition/example.ts.md'
const PROMPT_MIDDLEWARE = 'prompt-middleware'

/**
 * Exactly `count` prompt-middleware user messages mention the cognition href.
 * The single injection must also carry NO meta suffix: fresh is the default
 * state (steady-state silence = the provider writes no meta key), so any
 * `(stale` in the rendered text is the old always-write-stale regression.
 */
function cognitionLinkInjectedOnce(trace) {
  const injections = trace.userMessages
    .filter(message => message.source?.plugin === PROMPT_MIDDLEWARE)
    .filter(message => message.text.includes(COGNITION_HREF))
  if (injections.length !== 1) {
    return {
      ok: false,
      message: `expected exactly 1 ${PROMPT_MIDDLEWARE} injection mentioning ${COGNITION_HREF}, saw ${injections.length}`,
    }
  }
  const noisy = injections.filter(message => message.text.includes('(stale'))
  return {
    ok: noisy.length === 0,
    message: noisy.length === 0
      ? ''
      : `fresh pair injected with a stale meta suffix (steady-state silence broken): ${JSON.stringify(noisy.map(message => message.text))}`,
  }
}

export default {
  id: 'coggit-mock-touch-lane-roundtrip',
  mode: 'mock',
  task: 'eval driver: scripted touch lane round trip',
  async prepare(workspace) {
    await seedProject(workspace)
    await seedFreshCognition(workspace)
  },
  script: {
    steps: [
      toolCallStep('read', { file_path: 'src/example.ts' }),
      toolCallStep('read', { file_path: 'src/example.ts' }),
      toolCallStep('edit', { file_path: 'src/example.ts', old_string: '42', new_string: '43' }),
      textStep('Mock touch lane round trip complete.'),
    ],
  },
  expect: [
    firstTool('read'),
    {
      describe: `exactly one ${PROMPT_MIDDLEWARE} injection mentions ${COGNITION_HREF}, bare (no stale suffix)`,
      check: cognitionLinkInjectedOnce,
    },
    finalTextIncludes('Mock touch lane round trip complete.'),
  ],
}
