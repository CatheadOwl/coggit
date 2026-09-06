/** Blind comprehension review for the coggit projected tool views. */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { statusText, addProjection, resolveProjection, toJsonValue } from '../../lib/types/views.js'
import { defineReviewExperiment } from '@catheadowl/dsh-eval'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(readFileSync(join(here, 'fixtures.json'), 'utf8'))
const prompt = readFileSync(join(here, 'prompt.md'), 'utf8')

function projectScenario(scenario) {
  if (scenario.tool === 'coggit_status') {
    // The status face delivers core's canonical agent-facing TEXT (legend-once
    // + one-line rows), not a JSON view.
    return { id: scenario.id, tool: scenario.tool, text: statusText(scenario.result) }
  }
  const project = scenario.tool === 'coggit_add' ? addProjection : resolveProjection
  const { view, surfaceHints } = project(scenario.result)
  return { id: scenario.id, tool: scenario.tool, output: toJsonValue({ ...view, surfaceHints }) }
}

export default defineReviewExperiment({
  id: 'coggit-comprehension',
  summary: 'Can a fresh model understand coggit status/add/resolve projections and next actions?',
  prompt,
  rubric: join(here, 'rubric.md'),
  async observe() {
    const toolEntries = fixture.tools.map(tool => ({
      heading: tool.name,
      paragraphs: [tool.description, `Parameters: ${JSON.stringify(tool.parameters)}`],
    }))
    const scenarioEntries = fixture.scenarios.map(scenario => {
      const projected = projectScenario(scenario)
      return projected.text !== undefined
        ? {
            heading: `${projected.id} (${projected.tool})`,
            paragraphs: [projected.text],
          }
        : {
            heading: `${projected.id} (${projected.tool})`,
            json: projected.output,
          }
    })
    return [
      { heading: 'Tools', entries: toolEntries },
      { heading: 'Scenarios (the exact output each tool returns: coggit_status text, coggit_add/coggit_resolve JSON)', entries: scenarioEntries },
    ]
  },
})
