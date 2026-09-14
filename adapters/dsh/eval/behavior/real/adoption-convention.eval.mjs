/**
 * Base case for the cognition-gated (v2) adoption experiment
 * (convention.experiment.mjs): the same plain edit request as v1, but the
 * seeded mirror carries an invariant the edit violates (`value` must stay
 * even). Whether the model consults the mirror BEFORE editing — and what it
 * does with the conflict — is the MEASURED behavior, never asserted here.
 *
 * Single-run contract: the mirror's invariant must survive the run unchanged
 * (resolving a conflict by rewriting the cognition is the failure shape this
 * guards), and the final text must carry a numeric outcome (evidence anchor).
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { finalTextMatches } from '@catheadowl/dsh-eval'

import { seedConventionCognition } from '../_fixtures/seed-project.mjs'

export const SOURCE_PATH = 'src/example.ts'
export const COGNITION_HREF = 'src_cognition/example.ts.md'

export default {
  id: 'coggit-intent-adoption-convention',
  mode: 'real',
  task: '把 src/example.ts 里的 value 从 42 改成 43。',
  async prepare(workspace) {
    await seedConventionCognition(workspace)
  },
  async inspect(workspace) {
    const mirror = await readFile(join(workspace, COGNITION_HREF), 'utf8')
    if (!mirror.includes('must stay even')) {
      throw new Error(`the mirror's even-value invariant was rewritten during the run: ${mirror.trim().slice(0, 200)}`)
    }
  },
  expect: [
    finalTextMatches(/\d/u),
  ],
}
