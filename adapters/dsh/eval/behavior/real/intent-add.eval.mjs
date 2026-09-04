/**
 * Intent case (real model): a request to start tracking a source file should
 * reach the cognition write surface. The workspace is seeded with a REAL
 * CogGit project, so the call exercises the succeeding write path (not the
 * `no-projects` error branch); the assertion stays on tool selection.
 */
import { toolCalled, toolCallArgs } from '@catheadowl/dsh-eval'
import { seedProject } from '../_fixtures/seed-project.mjs'

export default {
  id: 'coggit-intent-add',
  mode: 'real',
  // Intent runs can legitimately loop (status -> skill load -> add -> re-check);
  // give the real model more room than the 180s default.
  timeoutMs: 300_000,
  task:
    'src/example.ts 这个源文件还没有配对认知文档。'
    + '请为它创建初始认知模板并纳入 CogGit 追踪，不要覆盖任何已有内容。'
    + '创建成功后简要报告结果并停止，不要继续撰写认知内容。',
  async prepare(workspace) {
    await seedProject(workspace)
  },
  expect: [
    toolCalled('coggit_add'),
    toolCallArgs('coggit_add', { sourcePath: 'src/example.ts' }),
  ],
}
