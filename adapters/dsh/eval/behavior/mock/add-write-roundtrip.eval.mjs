/**
 * Deterministic write-surface case: a real seeded project + a scripted
 * `coggit_add` call, asserting the cognition document and registry were
 * ACTUALLY written. Complements `intent-add` (which only asserts selection):
 * intent proves the model reaches the write surface, this case proves the
 * write surface works once reached.
 */
import {
  firstTool,
  toolResultFor,
  toolCallArgs,
  finalTextIncludes,
  toolCallStep,
  textStep,
} from '@catheadowl/dsh-eval'
import { seedProject, assertCognitionWritten } from '../_fixtures/seed-project.mjs'

export default {
  id: 'coggit-mock-add-write-roundtrip',
  mode: 'mock',
  task: 'eval driver: scripted add write round trip',
  async prepare(workspace) {
    await seedProject(workspace)
  },
  script: {
    steps: [
      toolCallStep('coggit_add', { sourcePath: 'src/example.ts' }),
      textStep('Mock add round trip complete.'),
    ],
  },
  expect: [
    firstTool('coggit_add'),
    toolCallArgs('coggit_add', { sourcePath: 'src/example.ts' }),
    toolResultFor('coggit_add'),
    finalTextIncludes('Mock add round trip complete.'),
  ],
  async inspect(workspace) {
    await assertCognitionWritten(workspace)
  },
}
