/**
 * Base case for the noise-salience glance experiment (glance.experiment.mjs).
 * Same flat task as the adoption pilot (change 42 -> 43, default-template
 * mirror, no payoff), but over the multi-file noise workspace and with a
 * multi-path prompt: the target plus two distractor paths are mentioned, so
 * the rendered injection block carries several competing cognition-link lines
 * — the shape the saturated single-file pilots lacked. The task is still
 * completable without reading any mirror; whether the model glances at the
 * TARGET pair before editing its source is the experiment's measurement, not
 * an asserted contract.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { finalTextMatches } from '@catheadowl/dsh-eval'

import { seedNoisyProject } from '../_fixtures/seed-project.mjs'

export const SOURCE_PATH = 'src/example.ts'
export const COGNITION_HREF = 'src_cognition/example.ts.md'
// Any other mirror read counts as a distractor glance (noise side metric).
export const COGNITION_ROOT = 'src_cognition'

export default {
  id: 'coggit-intent-glance-noise',
  mode: 'real',
  task: '把 src/example.ts 里的 value 从 42 改成 43；顺手确认 src/util/format.ts 和 src/lib/config.ts 里没有依赖这个值的地方。',
  async prepare(workspace) {
    await seedNoisyProject(workspace)
  },
  async inspect(workspace) {
    const edited = await readFile(join(workspace, SOURCE_PATH), 'utf8')
    if (!edited.includes('43')) throw new Error(`expected ${SOURCE_PATH} to contain 43 after the edit, saw: ${edited.trim()}`)
  },
  // Same evidence-anchor convention as the adoption case: the completion
  // contract only, never the probabilistic glance signal.
  expect: [
    finalTextMatches(/43/u),
  ],
}
