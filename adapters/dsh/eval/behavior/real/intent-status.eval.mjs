/**
 * Intent case (real model): a status request should reach the cognition
 * library's diagnostic surface first. Asserts tool SELECTION only — the
 * answer wording is the model's business.
 */
import { firstTool, toolCalled } from '@catheadowl/dsh-eval'

export default {
  id: 'coggit-intent-status',
  mode: 'real',
  task: '这个项目的认知库现在是什么状况？帮我诊断一下并总结。',
  expect: [
    firstTool('coggit_status'),
    toolCalled('coggit_status'),
  ],
}
