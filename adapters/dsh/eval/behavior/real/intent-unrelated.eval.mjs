/**
 * Intent case (real model): a task with no cognition-library intent must not
 * touch the coggit surfaces at all.
 */
import { toolNotCalled } from '@catheadowl/dsh-eval'

export default {
  id: 'coggit-intent-unrelated',
  mode: 'real',
  task: '17 乘以 23 等于多少？直接给出数字结果，不要使用任何工具。',
  expect: [
    toolNotCalled(/^coggit_/),
  ],
}
