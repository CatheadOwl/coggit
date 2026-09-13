/**
 * Blind comprehension review of the model-visible SURFACE (standing prompt
 * text + a rendered injection block), rather than of tool output: can a fresh
 * model, seeing only what an agent would see, derive the before-edit action,
 * the (stale) meaning, and the deviation-accounting clause?
 *
 * Snippet A is the frozen failure baseline (minimal overview + bare injection
 * block — the reviewer should NOT be able to derive the obligation, which also
 * calibrates the instrument: confident "yes, with quotes" on A means the
 * questions are leading). Snippet B adds the cognition-link directive. The
 * minimal overview and the directive are projected LIVE from the built lib /
 * core (projection changes flow into the experiment); only the renderer's
 * injection-block layout is frozen in fixtures.json.
 *
 * Run (explicit file — sibling discovery under eval/comprehension/ is
 * recursive, so the aggregate script targets each experiment file directly):
 *   dsh-review adapters/dsh/eval/comprehension/surface/surface.review.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getCoggitSystemPrompt } from '@coggit/core'
import { defineReviewExperiment } from '@catheadowl/dsh-eval'

import { COGNITION_LINK_DIRECTIVE } from '../../../lib/types/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(readFileSync(join(here, 'fixtures.json'), 'utf8'))
const prompt = readFileSync(join(here, 'prompt.md'), 'utf8')

function surfaceSnippet({ heading, standingText }) {
  return {
    heading,
    paragraphs: [
      `System prompt (excerpt):\n${standingText}`,
      `Context arriving with the task:\n${fixture.injectionBlock}`,
    ],
  }
}

export default defineReviewExperiment({
  id: 'coggit-surface-comprehension',
  summary: 'Can a fresh model derive the before-edit obligation and the (stale) meaning from the standing prompt surface alone — and does the cognition-link directive close the gap the bare surface leaves?',
  prompt,
  rubric: join(here, 'rubric.md'),
  async observe() {
    return [
      { heading: 'Surface snippets', entries: [
        surfaceSnippet({ heading: 'A', standingText: getCoggitSystemPrompt('minimal').content }),
        surfaceSnippet({ heading: 'B', standingText: `${getCoggitSystemPrompt('minimal').content}\n${COGNITION_LINK_DIRECTIVE}` }),
      ] },
    ]
  },
})
