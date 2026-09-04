/**
 * Deterministic layer: the scripted model forces one `coggit_status` call
 * through the REAL tool pipeline, then answers. No API key needed. Proves
 * the runner -> overlay -> adapter -> trace -> assertion chain end to end,
 * and that the plugin's tool executes inside the eval composition.
 */
import {
  firstTool,
  toolResultFor,
  finalTextIncludes,
  toolCallStep,
  textStep,
} from '@catheadowl/dsh-eval'

export default {
  id: 'coggit-mock-status-roundtrip',
  mode: 'mock',
  task: 'eval driver: scripted status round trip',
  script: {
    steps: [
      toolCallStep('coggit_status', {}),
      textStep('Mock evaluation complete.'),
    ],
  },
  expect: [
    firstTool('coggit_status'),
    toolResultFor('coggit_status'),
    finalTextIncludes('Mock evaluation complete.'),
  ],
}
