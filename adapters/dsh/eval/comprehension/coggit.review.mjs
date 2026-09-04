/** Blind comprehension review for the coggit projected tool views. */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { statusProjection, addProjection, resolveProjection, toJsonValue } from '../../lib/types/views.js'
import { defineReviewExperiment } from '@catheadowl/dsh-eval'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(readFileSync(join(here, 'fixtures.json'), 'utf8'))
const prompt = readFileSync(join(here, 'prompt.md'), 'utf8')
const PROJECTORS = { coggit_status: statusProjection, coggit_add: addProjection, coggit_resolve: resolveProjection }

function projectScenario(scenario) {
  const project = PROJECTORS[scenario.tool]
  if (!project) throw new Error(`unknown tool in scenario ${scenario.id}: ${scenario.tool}`)
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
      return {
        heading: `${projected.id} (${projected.tool})`,
        json: projected.output,
      }
    })
    return [
      { heading: 'Tools', entries: toolEntries },
      { heading: 'Scenarios (the exact JSON each tool returns)', entries: scenarioEntries },
    ]
  },
})
