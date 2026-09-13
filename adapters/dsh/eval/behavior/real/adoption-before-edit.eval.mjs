/**
 * Base case for the cognition-link adoption experiment (adoption.experiment.mjs).
 * A natural edit task over a seeded fresh cognition pair — the task wording
 * deliberately does NOT mention cognition, mirrors, or any doc path: whether
 * the model consults the paired cognition before editing is the MEASURED
 * behavior (experiment metrics), not an asserted one.
 *
 * Single-run asserts the completion contract via `inspect` plus one final-text
 * anchor (the file was actually edited AND the reply carries the demanded new
 * value; nothing else was fabricated) — adoption rate across arms is
 * the experiment's business.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { finalTextMatches } from '@catheadowl/dsh-eval'

import { seedProject, seedFreshCognition } from '../_fixtures/seed-project.mjs'

export const SOURCE_PATH = 'src/example.ts'
export const COGNITION_HREF = 'src_cognition/example.ts.md'

export default {
  id: 'coggit-intent-adoption-before-edit',
  mode: 'real',
  task: '把 src/example.ts 里的 value 从 42 改成 43。',
  async prepare(workspace) {
    await seedProject(workspace)
    await seedFreshCognition(workspace)
  },
  async inspect(workspace) {
    const edited = await readFile(join(workspace, SOURCE_PATH), 'utf8')
    if (!edited.includes('43')) throw new Error(`expected ${SOURCE_PATH} to contain 43 after the edit, saw: ${edited.trim()}`)
  },
  // The adoption signal (read of the cognition href before the source edit)
  // stays OUT of `expect`: it is extracted by the experiment's metrics, and
  // pinning it as a single-run matcher would make a probabilistic measurement
  // read like a deterministic contract. The one matcher here is the evidence
  // anchor every case must carry: the task demands the value become 43, so the
  // final text must carry that demanded outcome.
  expect: [
    finalTextMatches(/43/u),
  ],
}
