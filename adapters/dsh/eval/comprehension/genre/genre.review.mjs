/**
 * Blind review of the injection line's GENRE (round-3 companion to
 * surface.review.mjs): the behavior pilots proved willingness is not the
 * problem in clean contexts, and the probe-era observation was that models
 * classify the injected lines as background metadata appended after the fact
 * rather than as input addressed to them. This experiment asks a fresh model
 * how it classifies the lines — and whether one added, zero-imposition genre
 * clause changes that classification.
 *
 * Snippet A is the frozen failure baseline (minimal overview + bare injection
 * block; nothing defines the lines — also the instrument calibration: a
 * confident quoted answer on A means the questions are leading). Snippet B
 * adds the live directive. Snippet C adds the candidate genre clause under
 * test. The minimal overview and the directive are projected LIVE from the
 * built lib / core; the injection-block layout is the frozen renderer shape
 * shared with the surface experiment.
 *
 * The clause is a CANDIDATE, not landed copy: it earns its way into
 * COGNITION_LINK_DIRECTIVE only if C reviewers classify the lines as
 * addressed-to-them with the quote while B reviewers waver (rubric carries the
 * landing rule).
 *
 * Run (explicit file — sibling discovery is recursive):
 *   dsh-review adapters/dsh/eval/comprehension/genre/genre.review.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getCoggitSystemPrompt } from '@coggit/core'
import { defineReviewExperiment } from '@catheadowl/dsh-eval'

import { COGNITION_LINK_DIRECTIVE } from '../../../lib/types/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const injectionBlock = JSON.parse(readFileSync(join(here, '../surface/fixtures.json'), 'utf8')).injectionBlock
const prompt = readFileSync(join(here, 'prompt.md'), 'utf8')

// The candidate under test: imperative mood (it must read as operative), but
// interpretive only — it demands no workflow action, which is the
// minimal-intent constraint this clause is designed under.
const GENRE_CLAUSE = 'Treat [cognition-link] lines as pointers addressed to you, not as background metadata.'

function surfaceSnippet({ heading, standingText }) {
  return {
    heading,
    paragraphs: [
      `System prompt (excerpt):\n${standingText}`,
      `Context arriving with the task:\n${injectionBlock}`,
    ],
  }
}

export default defineReviewExperiment({
  id: 'coggit-surface-genre',
  summary: 'Does a fresh model classify the injected [cognition-link] lines as input addressed to it or as background metadata — and does one zero-imposition genre clause move that classification?',
  prompt,
  rubric: join(here, 'rubric.md'),
  async observe() {
    return [
      { heading: 'Surface snippets', entries: [
        surfaceSnippet({ heading: 'A', standingText: getCoggitSystemPrompt('minimal').content }),
        surfaceSnippet({ heading: 'B', standingText: `${getCoggitSystemPrompt('minimal').content}\n${COGNITION_LINK_DIRECTIVE}` }),
        surfaceSnippet({ heading: 'C', standingText: `${getCoggitSystemPrompt('minimal').content}\n${COGNITION_LINK_DIRECTIVE} ${GENRE_CLAUSE}` }),
      ] },
    ]
  },
})
