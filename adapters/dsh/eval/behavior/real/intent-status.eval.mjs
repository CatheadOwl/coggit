/**
 * Intent case (real model): a status request should reach the cognition
 * library's diagnostic surface. Asserts tool SELECTION only — the answer
 * wording is the model's business.
 *
 * The workspace is seeded with a REAL CogGit project: the adapter hides the
 * `coggit_*` schemas when the session workspace carries no `.coggit/config.yaml`,
 * so an unseeded run asks the model to call a tool it cannot see (the 2/2
 * timeout-with-zero-calls failure of 2026-09-14, root-caused 2026-10-17).
 */
import { toolCalled } from '@catheadowl/dsh-eval'
import { seedProject } from '../_fixtures/seed-project.mjs'

export default {
  id: 'coggit-intent-status',
  mode: 'real',
  // Intent runs can legitimately loop (skill load -> status -> summarize);
  // give the real model more room than the 180s default.
  timeoutMs: 300_000,
  task: '这个项目的认知库现在是什么状况？帮我诊断一下并总结。',
  async prepare(workspace) {
    await seedProject(workspace)
  },
  expect: [toolCalled('coggit_status')],
}
