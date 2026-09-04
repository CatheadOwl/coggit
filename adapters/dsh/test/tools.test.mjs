// Mock-apply tool-surface test: capture what `registerCoggitTools` registers
// with a thin fake `ctx`, then assert the exact model-facing surface — three
// tools, correct names, and schema/execute passthrough. This replaces the
// "restart dsh and eyeball the GUI" check for tool-surface changes.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { fromLib } from './helpers.mjs'

/**
 * Thin fake `ctx` for the tools path: `tools.register` captures definitions,
 * `get('coggit')` returns a scripted `CoggitService` stub.
 */
function makeCtx(serviceStub) {
  const fake = {
    tools: { register(def) { fake.defs.push(def) } },
    defs: [],
    get(name) {
      if (name === 'coggit') return serviceStub
      throw new Error('unexpected ctx.get(' + name + ')')
    },
  }
  return fake
}

const exec = { agent: { session: { header: { cwd: 'D:/ws' } } } }

test('registerCoggitTools registers exactly three coggit_* tools', async () => {
  const { registerCoggitTools } = await import(fromLib('tools'))
  const ctx = makeCtx({})
  registerCoggitTools(ctx)
  const names = ctx.defs.map(d => d.name).sort()
  assert.deepEqual(names, ['coggit_add', 'coggit_resolve', 'coggit_status'])
})

test('removed tools are absent from the registered surface', async () => {
  const { registerCoggitTools } = await import(fromLib('tools'))
  const ctx = makeCtx({})
  registerCoggitTools(ctx)
  const names = ctx.defs.map(d => d.name)
  for (const gone of ['coggit_snapshot', 'coggit_routes']) {
    assert.equal(names.includes(gone), false, `${gone} must not be registered`)
  }
})

test('each tool declares a json output with render and execute callbacks', async () => {
  const { registerCoggitTools } = await import(fromLib('tools'))
  const ctx = makeCtx({})
  registerCoggitTools(ctx)
  for (const def of ctx.defs) {
    // defineTool normalizes the 'json' shorthand to a JSON-schema node; assert
    // the output declaration survived with render + execute, not its literal spec.
    assert.ok(def.output, 'tool must declare an output')
    assert.equal(typeof def.output.render, 'function')
    assert.equal(typeof def.execute, 'function')
  }
})

test('coggit_status defaults sourcePath and projects a JSON-safe view', async () => {
  const { registerCoggitTools } = await import(fromLib('tools'))
  const statusResult = {
    found: true, sourcePath: '.', nodeKind: 'root', project: { label: 'ws' },
    cognitionPath: 'README.md', status: 'fresh', ownStatus: 'fresh', descendantStatus: null,
    staleAction: null, issueCount: 0, ownIssueCount: 0, descendantIssueCount: 0,
    issues: [], suggestedActions: [], handbookId: null,
    pathHints: [],
    inspection: {
      sourcePath: '.', cognitionPath: 'README.md', cognitionPresence: 'present',
      nodeKind: 'root', status: 'fresh', ownStatus: 'fresh', descendantStatus: null,
      issueSummary: { total: 0, own: 0, descendant: 0 },
      subtreeIssues: { own: [], descendant: [] },
      suggestedActions: [], handbookId: null,
      triage: [],
    },
  }
  const ctx = makeCtx({
    status: async (_ws, sourcePath) => ({ ...statusResult, sourcePath }),
  })
  registerCoggitTools(ctx)

  const statusTool = ctx.defs.find(d => d.name === 'coggit_status')
  const out = await statusTool.execute({}, exec)
  assert.equal('node' in out, false, 'status view must drop the cyclic node')
  assert.equal('inspection' in out, false, 'status view must drop the raw inspection')
  assert.equal('handbookId' in out, false)
  assert.equal('found' in out, false, 'a hit omits found')
  assert.equal('nodeKind' in out, false)
  assert.equal('projectLabel' in out, false)
  assert.equal(out.sourcePath, '.', 'omitted sourcePath defaults to "."')
  assert.equal(out.cognitionPath, 'README.md')
  assert.equal(out.cognitionPresence, 'present')
  assert.equal(out.status, 'fresh')
  // Follows core StatusAgentPresentation (canonical compact status view).
  assert.equal(out.ownIssueCount, 0)
  assert.equal(out.descendantIssueCount, 0)
  assert.deepEqual(out.ownIssues, [])
  assert.deepEqual(out.descendantIssues, [])
  assert.deepEqual(out.issueLegend, [])
  assert.deepEqual(out.actionLegend, [])
  assert.ok(Array.isArray(out.surfaceHints))
})

test('coggit_add forwards kind/overwrite and projects a success view', async () => {
  const { registerCoggitTools } = await import(fromLib('tools'))
  const addResult = {
    success: true, created: true, kind: 'leaf', sourcePath: 'src/a.ts',
    cognitionPath: 'src_cognition/a.ts.md',
    project: { label: 'ws', configUri: 'file:///x/.coggit/config.yaml', projectRootUri: 'file:///x', sourceRoot: 'src', cognitionRoot: 'src_cognition', sourcePathRule: 'src/**' },
    handbookId: 'leaf',
    suggestedActions: [], error: null, pathHints: [],
  }
  let seen
  const ctx = makeCtx({
    add: async (_ws, sourcePath, opts) => { seen = { sourcePath, opts }; return addResult },
  })
  registerCoggitTools(ctx)

  const addTool = ctx.defs.find(d => d.name === 'coggit_add')
  const out = await addTool.execute({ sourcePath: 'src/a.ts', kind: 'leaf', overwrite: false }, exec)
  assert.deepEqual(seen, { sourcePath: 'src/a.ts', opts: { kind: 'leaf', overwrite: false } })
  assert.equal(out.success, true)
  assert.equal(out.created, true)
  assert.equal(out.kind, 'leaf')
  assert.equal(out.cognitionPath, 'src_cognition/a.ts.md')
  assert.equal('project' in out, false, 'add view must drop the project URI context')
  assert.equal('handbookId' in out, false, 'handbookId is redundant with surfaceHints')
  assert.equal('error' in out, false, 'a success view omits error')
  assert.ok(out.surfaceHints.some(h => h.includes('coggit-handbook-leaf')))
  assert.equal(out.surfaceHints.some(h => h.includes('coggit_status')), false, 'success carries no re-check action')
})

test('coggit_resolve projects a success view and drops receipt internals', async () => {
  const { registerCoggitTools } = await import(fromLib('tools'))
  const resolveResult = {
    success: true, sourcePath: 'src/b.ts', cognitionPath: 'src_cognition/b.ts.md',
    project: { label: 'ws', configUri: 'file:///x/.coggit/config.yaml', projectRootUri: 'file:///x', sourceRoot: 'src', cognitionRoot: 'src_cognition', sourcePathRule: 'src/**' },
    sourceKey: 'src/b.ts', verificationTimeMs: 1724000000000,
    suggestedActions: [], error: null, pathHints: [],
  }
  const ctx = makeCtx({
    resolve: async (_ws, sourcePath) => ({ ...resolveResult, sourcePath }),
  })
  registerCoggitTools(ctx)

  const resolveTool = ctx.defs.find(d => d.name === 'coggit_resolve')
  const out = await resolveTool.execute({ sourcePath: 'src/b.ts' }, exec)
  assert.equal(out.success, true)
  assert.equal(out.sourcePath, 'src/b.ts')
  assert.equal(out.cognitionPath, 'src_cognition/b.ts.md')
  assert.equal('project' in out, false, 'resolve view must drop the project URI context')
  assert.equal('sourceKey' in out, false, 'registry key is receipt data, not a next-step signal')
  assert.equal('verificationTimeMs' in out, false, 'timestamp is receipt data, not a next-step signal')
  assert.equal('error' in out, false)
  assert.deepEqual(out.surfaceHints, [], 'resolve success is self-confirming: no re-check, no next step')
})

test('coggit_resolve projects a path miss with candidates and no re-check hint', async () => {
  const { registerCoggitTools } = await import(fromLib('tools'))
  const resolveResult = {
    success: false, sourcePath: 'src/nope.ts', cognitionPath: null,
    project: null, sourceKey: null, verificationTimeMs: null,
    suggestedActions: [],
    error: { code: 'path-not-found', message: 'Path not found in any CogGit project.' },
    pathHints: ['src/note.ts'],
    pathMissMessage: 'Path not found in any CogGit project: src/nope.ts',
    pathHintMessage: 'You may mean one of these source-root-relative source paths.',
  }
  const ctx = makeCtx({
    resolve: async (_ws, sourcePath) => ({ ...resolveResult, sourcePath }),
  })
  registerCoggitTools(ctx)

  const resolveTool = ctx.defs.find(d => d.name === 'coggit_resolve')
  const out = await resolveTool.execute({ sourcePath: 'src/nope.ts' }, exec)
  assert.equal(out.success, false)
  assert.deepEqual(out.error, { code: 'path-not-found', message: 'Path not found in any CogGit project.' })
  assert.deepEqual(out.pathHints, ['src/note.ts'])
  assert.equal('cognitionPath' in out, false, 'a miss omits the null cognitionPath')
  assert.equal('sourceKey' in out, false)
  assert.equal('verificationTimeMs' in out, false)
  assert.equal('project' in out, false)
  assert.equal('pathMissMessage' in out, false)
  assert.equal('pathHintMessage' in out, false)
  assert.deepEqual(out.surfaceHints, [
    'Try one of these source-root-relative paths: "src/note.ts".',
  ])
})
