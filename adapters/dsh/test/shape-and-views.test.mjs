// Plugin shape + pure view-function tests. Imports the BUILT `lib/` artifacts,
// so it needs no Cordis process and no `@deepseek-ai/*` junctions.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'
import { join } from 'node:path'

import { createInitializedProject, fromLib, libRoot, makeTempDir, removeTempDir } from './helpers.mjs'

test('plugin exports the function-plugin shape with no default export', async () => {
  // The shipped entry is the tsc output at lib/types/index.js (package.json
  // "main" / exports "."). The tsdown bundle lib/index.js cannot be rebuilt
  // while upstream's out-of-tree manifest bug is open
  // (upstream-issues/20260822-1900-tsdown-out-of-tree-manifest), so the
  // suite pins the entry the host actually loads.
  const entryUrl = new URL('types/index.js', new URL('file://' + libRoot.replace(/\\/g, '/') + '/')).href
  const mod = await import(entryUrl)
  assert.equal(mod.name, 'coggit')
  assert.deepEqual(mod.inject, ['tools', 'skills', 'systemPrompt'])
  assert.equal(typeof mod.apply, 'function')
  // A function plugin MUST NOT default-export; the Loader would drop its namespace.
  assert.equal('default' in mod, false, 'function plugin must not carry a default export')
})

test('apply registers handbook skills as model-only runtime skills', async () => {
  const mod = await import(fromLib('index'))
  const registered = []
  const ctx = {
    plugin: async () => {},
    skills: { register(skill) { registered.push(skill) } },
    tools: { register() {} },
    systemPrompt: { section() {} },
    inject() {},
    on() {},
    get(name) { if (name === 'coggit') return {}; throw new Error('unexpected ctx.get(' + name + ')') },
  }
  await mod.apply(ctx, {})
  const skills = registered.filter(s => s.name.startsWith('coggit-handbook-'))
  assert.deepEqual(skills.map(s => s.name).sort(), ['coggit-handbook-leaf', 'coggit-handbook-skeleton'])
  for (const skill of skills) {
    assert.deepEqual(skill.invocation, { modelInvocable: true, userInvocable: false })
  }
})

test('apply registers the top-level guidance as one system-prompt section', async () => {
  const mod = await import(fromLib('index'))
  const sections = []
  const ctx = {
    plugin: async () => {},
    skills: { register() {} },
    tools: { register() {} },
    systemPrompt: { section(section) { sections.push(section) } },
    inject() {},
    on() {},
    get(name) { if (name === 'coggit') return {}; throw new Error('unexpected ctx.get(' + name + ')') },
  }
  await mod.apply(ctx, {})
  assert.equal(sections.length, 1)
  assert.equal(sections[0].name, 'coggit:overview')
  assert.equal(sections[0].order, 117)
  assert.equal(typeof sections[0].text, 'function', 'text is a lazy provider, not a static string')
})

test('section text hides the overview on an unconfigured workspace and renders it when configured', async () => {
  const mod = await import(fromLib('index'))
  const sections = []
  const ctx = {
    plugin: async () => {},
    skills: { register() {} },
    tools: { register() {} },
    systemPrompt: { section(section) { sections.push(section) } },
    inject() {},
    on() {},
    get(name) { if (name === 'coggit') return {}; throw new Error('unexpected ctx.get(' + name + ')') },
  }
  await mod.apply(ctx, {})
  const text = sections.find(s => s.name === 'coggit:overview').text

  const unconfigured = await makeTempDir('coggit-noconfig')
  try {
    assert.equal(text({ agent: { session: { header: { cwd: unconfigured } } } }), '', 'no .coggit/config.yaml → empty section')
  } finally {
    await removeTempDir(unconfigured)
  }

  const configured = await makeTempDir('coggit-config')
  try {
    await createInitializedProject(configured)
    const rendered = text({ agent: { session: { header: { cwd: configured } } } })
    assert.equal(typeof rendered, 'string')
    assert.ok(rendered.length > 0, '.coggit/config.yaml present → overview renders')
  } finally {
    await removeTempDir(configured)
  }
})

test('assemble waterfall hides coggit_* tools on an unconfigured workspace only', async () => {
  const mod = await import(fromLib('index'))
  let assembleListener
  const ctx = {
    plugin: async () => {},
    skills: { register() {} },
    tools: { register() {} },
    systemPrompt: { section() {} },
    inject() {},
    on(name, listener) { if (name === 'system-prompt/assemble') assembleListener = listener },
    get(name) { if (name === 'coggit') return {}; throw new Error('unexpected ctx.get(' + name + ')') },
  }
  await mod.apply(ctx, {})
  assert.equal(typeof assembleListener, 'function', 'apply must register a system-prompt/assemble listener')

  const base = () => ({
    sections: [],
    tools: [{ name: 'coggit_status' }, { name: 'coggit_add' }, { name: 'coggit_resolve' }, { name: 'read' }],
    variables: {},
  })

  const unconfigured = await makeTempDir('coggit-noconfig')
  try {
    const out = await assembleListener({}, { agent: { session: { header: { cwd: unconfigured } } } }, async () => base())
    assert.deepEqual(out.tools.map(t => t.name), ['read'], 'unconfigured workspace hides every coggit_* tool')
  } finally {
    await removeTempDir(unconfigured)
  }

  const configured = await makeTempDir('coggit-config')
  try {
    await createInitializedProject(configured)
    const out = await assembleListener({}, { agent: { session: { header: { cwd: configured } } } }, async () => base())
    assert.deepEqual(out.tools.map(t => t.name).sort(), ['coggit_add', 'coggit_resolve', 'coggit_status', 'read'], 'configured workspace keeps coggit_* tools')
  } finally {
    await removeTempDir(configured)
  }
})

test('lib artifacts exist for every module the suite exercises', async () => {
  // tsc emits to lib/types/*.js; the tsdown bundle (lib/index.js) is a legacy
  // artifact kept until upstream fixes the out-of-tree manifest lookup.
  for (const rel of ['index.js', 'types/index.js', 'types/views.js', 'types/tools.js', 'types/service.js']) {
    await access(join(libRoot, rel))
  }
})

test('handbookSkillName maps both handbook kinds', async () => {
  const { handbookSkillName } = await import(fromLib('views'))
  assert.equal(handbookSkillName('leaf'), 'coggit-handbook-leaf')
  assert.equal(handbookSkillName('skeleton'), 'coggit-handbook-skeleton')
})

test('operationToolName keeps the FULL core vocabulary (boundary contract)', async () => {
  // The mapping must stay explicit over core's complete operation-id set, even
  // for operations this surface removed: active results never carry snapshot/
  // routes ops, but the translation table must not depend on naming coincidence.
  const { operationToolName } = await import(fromLib('views'))
  for (const op of ['snapshot', 'status', 'add', 'resolve', 'routes']) {
    assert.equal(operationToolName(op), `coggit_${op}`)
  }
})

test('renderJson emits a single lossless-JSON text block', async () => {
  const { renderJson } = await import(fromLib('views'))
  const blocks = renderJson({ a: 1, b: [null, 'x'] })
  assert.equal(blocks.length, 1)
  assert.deepEqual(blocks[0], { type: 'text', text: JSON.stringify({ a: 1, b: [null, 'x'] }, null, 2) })
})

test('toJsonValue projects undefined (props omitted, array items -> null)', async () => {
  const { toJsonValue } = await import(fromLib('views'))
  assert.deepEqual(toJsonValue({ a: 1, drop: undefined }), { a: 1 })
  assert.deepEqual(toJsonValue([1, undefined, 3]), [1, null, 3])
  assert.deepEqual(toJsonValue({ nested: { x: undefined } }), { nested: {} })
})

test('statusProjection hit emits the core HIT projection without leaking internals', async () => {
  const { statusProjection } = await import(fromLib('views'))
  const { view } = statusProjection({
    found: true,
    sourcePath: 'coggit/src/views.ts',
    nodeKind: 'file',
    cognitionPath: 'coggit/src/views.ts.md',
    project: { label: 'demo' },
    status: 'stale',
    ownStatus: 'stale',
    descendantStatus: null,
    handbookId: 'leaf',
    pathHints: [],
    suggestedActions: [
      { code: 'sync-cognition-with-source', label: 'Sync cognition with source changes', handbookId: 'leaf', sourcePath: 'coggit/src/views.ts' },
      { code: 'resolve-stale-cognition', label: 'After syncing, accept the pair as reviewed', operation: 'resolve', sourcePath: 'coggit/src/views.ts' },
    ],
    inspection: {
      sourcePath: 'coggit/src/views.ts',
      cognitionPath: 'coggit/src/views.ts.md',
      cognitionPresence: 'present',
      nodeKind: 'file',
      status: 'stale',
      ownStatus: 'stale',
      descendantStatus: null,
      issueSummary: { total: 1, own: 1, descendant: 0 },
      subtreeIssues: {
        own: [{
          nodeId: 'x', nodeKind: 'file', relativePath: 'coggit/src/views.ts', cognitionPath: 'coggit/src/views.ts.md',
          sourceUri: { scheme: 'file', authority: '', path: '/x/views.ts', query: '', fragment: '' },
          hasPairedCognition: true,
          issue: {
            diagnostic: { code: 'outdated-cognition', severity: 'warning', message: 'Stale cognition.' },
            actions: [{ label: 'Sync cognition with source changes' }],
          },
        }],
        descendant: [],
      },
      suggestedActions: [
        { code: 'sync-cognition-with-source', label: 'Sync cognition with source changes', handbookId: 'leaf', sourcePath: 'coggit/src/views.ts' },
        { code: 'resolve-stale-cognition', label: 'After syncing, accept the pair as reviewed', operation: 'resolve', sourcePath: 'coggit/src/views.ts' },
      ],
      handbookId: 'leaf',
      triage: [],
    },
  })
  // The hit view is core's canonical StatusAgentPresentation — the same
  // structured projection the upstream CLI/MCP text render.
  assert.equal('node' in view, false, 'view must not leak the cyclic node')
  assert.equal('inspection' in view, false, 'view must not leak the raw inspection subtree')
  assert.equal('project' in view, false, 'view must not leak the project URI context')
  assert.equal('handbookId' in view, false, 'handbookId is redundant with surfaceHints')
  assert.equal('found' in view, false, 'a hit omits found')
  assert.equal('pathHints' in view, false, 'empty pathHints is omitted')
  assert.equal('ownStatus' in view, false, 'ownStatus is not part of the canonical agent presentation')
  assert.equal('descendantStatus' in view, false, 'descendantStatus is not part of the canonical agent presentation')
  assert.equal('triage' in view, false, 'triage is replaced by rows + legends in the agent presentation')
  assert.equal(view.sourcePath, 'coggit/src/views.ts')
  assert.equal(view.cognitionPath, 'coggit/src/views.ts.md')
  assert.equal(view.cognitionPresence, 'present')
  assert.equal(view.status, 'stale')
  assert.equal(view.ownIssueCount, 1)
  assert.equal(view.descendantIssueCount, 0)
  assert.deepEqual(view.ownIssues[0], {
    sourcePath: 'coggit/src/views.ts',
    level: 'WARN',
    issueTags: ['stale-cognition'],
    actionTags: ['sync-leaf', 'resolve'],
    optionalActionTags: [],
  })
  assert.deepEqual(view.descendantIssues, [])
  assert.deepEqual(view.issueLegend, [{
    level: 'WARN',
    tag: 'stale-cognition',
    description: 'Cognition is out of date with source.',
    hints: [],
  }])
  assert.deepEqual(view.actionLegend, [
    { tag: 'sync-leaf', role: 'recommended', description: 'Read leaf handbook and sync cognition with source.' },
    { tag: 'resolve', role: 'recommended', description: 'Accept the reviewed pair after sync.' },
  ])
})



test('statusProjection miss branch carries only found:false + sourcePath + pathHints', async () => {
  const { statusProjection } = await import(fromLib('views'))
  const { view } = statusProjection({
    found: false,
    sourcePath: 'src/nope.ts',
    nodeKind: null,
    cognitionPath: null,
    project: null,
    status: null,
    ownStatus: null,
    descendantStatus: null,
    handbookId: null,
    pathHints: ['src/note.ts'],
    pathMissMessage: 'No source path matched.',
    pathHintMessage: 'Did you mean:',
  })
  assert.equal(view.found, false)
  assert.deepEqual(view.pathHints, ['src/note.ts'])
  // A miss carries no status/issue fields (those only exist once a node is found).
  assert.equal('cognitionPath' in view, false)
  assert.equal('cognitionPresence' in view, false)
  assert.equal('status' in view, false)
  assert.equal('ownStatus' in view, false)
  assert.equal('descendantStatus' in view, false)
  assert.equal('ownIssues' in view, false)
  assert.equal('descendantIssues' in view, false)
  assert.equal('pathMissMessage' in view, false, 'miss prose is not a next-step signal')
  assert.equal('pathHintMessage' in view, false, 'miss prose is not a next-step signal')
})

test('statusProjection miss with no fuzzy hints omits pathHints', async () => {
  const { statusProjection } = await import(fromLib('views'))
  const { view } = statusProjection({
    found: false,
    sourcePath: 'zzz/unknown.ts',
    nodeKind: null,
    cognitionPath: null,
    project: null,
    status: null,
    ownStatus: null,
    descendantStatus: null,
    handbookId: null,
    pathHints: [],
    pathMissMessage: 'Path not found.',
  })
  assert.equal(view.found, false)
  assert.equal('pathHints' in view, false, 'empty pathHints is omitted')
})

test('statusProjection miss surfaces fuzzy candidates (no re-check)', async () => {
  const { statusProjection } = await import(fromLib('views'))
  const { view, surfaceHints } = statusProjection({
    found: false,
    sourcePath: 'src/nope.ts',
    nodeKind: null,
    cognitionPath: null,
    project: null,
    status: null,
    ownStatus: null,
    descendantStatus: null,
    handbookId: null,
    suggestedActions: [],
    pathHints: ['src/note.ts', 'src/notes.ts'],
  })
  assert.equal(view.found, false)
  assert.deepEqual(surfaceHints, [
    'Try one of these source-root-relative paths: "src/note.ts", "src/notes.ts".',
  ])
})

test('statusProjection miss with no candidates yields empty surfaceHints', async () => {
  const { statusProjection } = await import(fromLib('views'))
  const { surfaceHints } = statusProjection({
    found: false,
    sourcePath: 'zzz/unknown.ts',
    nodeKind: null,
    cognitionPath: null,
    project: null,
    status: null,
    ownStatus: null,
    descendantStatus: null,
    handbookId: null,
    pathHints: [],
  })
  assert.deepEqual(surfaceHints, [])
})

test('statusProjection hit maps the core add next step to coggit_add', async () => {
  const { statusProjection } = await import(fromLib('views'))
  const { view, surfaceHints } = statusProjection({
    found: true,
    sourcePath: 'uncognized.ts',
    nodeKind: 'file',
    cognitionPath: 'uncognized.ts.md',
    project: null,
    status: null,
    ownStatus: null,
    descendantStatus: null,
    handbookId: 'leaf',
    pathHints: [],
    suggestedActions: [{ code: 'create-cognition', label: 'Create cognition file', operation: 'add', sourcePath: 'uncognized.ts' }],
    inspection: {
      sourcePath: 'uncognized.ts',
      cognitionPath: 'uncognized.ts.md',
      cognitionPresence: 'missing',
      nodeKind: 'file',
      status: null,
      ownStatus: null,
      descendantStatus: null,
      issueSummary: { total: 0, own: 0, descendant: 0 },
      subtreeIssues: { own: [], descendant: [] },
      suggestedActions: [{ code: 'create-cognition', label: 'Create cognition file', operation: 'add', sourcePath: 'uncognized.ts' }],
      handbookId: 'leaf',
      triage: [],
    },
  })
  assert.equal('found' in view, false, 'a hit omits found')
  assert.equal(view.cognitionPresence, 'missing')
  assert.deepEqual(surfaceHints, [
    'Call coggit_add with sourcePath="uncognized.ts".',
    'Before authoring or editing this cognition, load skill "coggit-handbook-leaf" with the skill tool.',
  ])
})

test('statusProjection hit with no operation actions yields only the handbook hint', async () => {
  const { statusProjection } = await import(fromLib('views'))
  const { surfaceHints } = statusProjection({
    found: true,
    sourcePath: 'foo.ts',
    nodeKind: 'file',
    cognitionPath: 'foo.ts.md',
    project: null,
    status: 'fresh',
    ownStatus: 'fresh',
    descendantStatus: null,
    handbookId: 'leaf',
    pathHints: [],
    suggestedActions: [],
    inspection: {
      sourcePath: 'foo.ts',
      cognitionPath: 'foo.ts.md',
      cognitionPresence: 'present',
      nodeKind: 'file',
      status: 'fresh',
      ownStatus: 'fresh',
      descendantStatus: null,
      issueSummary: { total: 0, own: 0, descendant: 0 },
      subtreeIssues: { own: [], descendant: [] },
      suggestedActions: [],
      handbookId: 'leaf',
      triage: [],
    },
  })
  assert.deepEqual(surfaceHints, [
    'Before authoring or editing this cognition, load skill "coggit-handbook-leaf" with the skill tool.',
  ])
})

test('statusProjection hit maps the core resolve next step to coggit_resolve', async () => {
  const { statusProjection } = await import(fromLib('views'))
  const { view, surfaceHints } = statusProjection({
    found: true,
    sourcePath: 'foo.ts',
    nodeKind: 'file',
    cognitionPath: 'foo.ts.md',
    project: null,
    status: 'stale',
    ownStatus: 'stale',
    descendantStatus: null,
    handbookId: 'leaf',
    pathHints: [],
    suggestedActions: [
      { code: 'sync-cognition-with-source', label: 'Sync cognition', handbookId: 'leaf', sourcePath: 'foo.ts' },
      { code: 'resolve-stale-cognition', label: 'Accept the synced cognition as reviewed', operation: 'resolve', sourcePath: 'foo.ts' },
    ],
    inspection: {
      sourcePath: 'foo.ts',
      cognitionPath: 'foo.ts.md',
      cognitionPresence: 'present',
      nodeKind: 'file',
      status: 'stale',
      ownStatus: 'stale',
      descendantStatus: null,
      issueSummary: { total: 0, own: 0, descendant: 0 },
      subtreeIssues: { own: [], descendant: [] },
      suggestedActions: [
        { code: 'sync-cognition-with-source', label: 'Sync cognition', handbookId: 'leaf', sourcePath: 'foo.ts' },
        { code: 'resolve-stale-cognition', label: 'Accept the synced cognition as reviewed', operation: 'resolve', sourcePath: 'foo.ts' },
      ],
      handbookId: 'leaf',
      triage: [],
    },
  })
  assert.equal(view.status, 'stale')
  // Top-level handbookId is suppressed: the sync action already carries handbookId='leaf'.
  assert.deepEqual(surfaceHints, [
    'Before authoring or editing this cognition, load skill "coggit-handbook-leaf" with the skill tool.',
    'Call coggit_resolve with sourcePath="foo.ts".',
  ])
})

test('statusProjection hit with null status and no actions does NOT prepend coggit_add', async () => {
  const { statusProjection } = await import(fromLib('views'))
  const { surfaceHints } = statusProjection({
    found: true,
    sourcePath: 'mystery.ts',
    nodeKind: 'file',
    cognitionPath: 'mystery.ts.md',
    project: null,
    status: null,
    ownStatus: null,
    descendantStatus: null,
    handbookId: null,
    pathHints: [],
    suggestedActions: [],
    inspection: {
      sourcePath: 'mystery.ts',
      cognitionPath: 'mystery.ts.md',
      cognitionPresence: 'not-applicable',
      nodeKind: 'file',
      status: null,
      ownStatus: null,
      descendantStatus: null,
      issueSummary: { total: 0, own: 0, descendant: 0 },
      subtreeIssues: { own: [], descendant: [] },
      suggestedActions: [],
      handbookId: null,
      triage: [],
    },
  })
  assert.deepEqual(surfaceHints, [], 'status null alone is not a create-cognition signal')
})

test('statusProjection hit includes triage with mapped surfaceHints', async () => {
  const { statusProjection } = await import(fromLib('views'))
  const { view, surfaceHints } = statusProjection({
    found: true, sourcePath: 'coggit/src', nodeKind: 'folder', cognitionPath: 'coggit/src/README.md',
    project: null, status: 'stale', ownStatus: 'stale', descendantStatus: 'stale',
    handbookId: 'skeleton', pathHints: [], suggestedActions: [
      { code: 'sync-cognition-with-source', label: 'Sync folder README with child structure changes', handbookId: 'skeleton', sourcePath: 'coggit/src' },
      { code: 'resolve-stale-cognition', label: 'After syncing, accept the pair as reviewed', operation: 'resolve', sourcePath: 'coggit/src' },
    ],
    inspection: {
      sourcePath: 'coggit/src', cognitionPath: 'coggit/src/README.md', cognitionPresence: 'present',
      nodeKind: 'folder', status: 'stale', ownStatus: 'stale', descendantStatus: 'stale',
      issueSummary: { total: 2, own: 1, descendant: 1 },
      subtreeIssues: {
        own: [{
          nodeId: 'n1', nodeKind: 'folder', relativePath: 'coggit/src', cognitionPath: 'coggit/src/README.md',
          sourceUri: { scheme: 'file', authority: '', path: '/x/src', query: '', fragment: '' },
          hasPairedCognition: true,
          issue: {
            diagnostic: { code: 'folder-structure-outdated', severity: 'warning', message: 'Stale folder README.' },
            actions: [{ label: 'Sync folder README with child structure changes' }],
          },
        }],
        descendant: [{
          nodeId: 'n2', nodeKind: 'file', relativePath: 'coggit/src/views.ts', cognitionPath: 'coggit/src/views.ts.md',
          sourceUri: { scheme: 'file', authority: '', path: '/x/src/views.ts', query: '', fragment: '' },
          hasPairedCognition: true,
          issue: {
            diagnostic: { code: 'outdated-cognition', severity: 'warning', message: 'Stale cognition.' },
            actions: [{ label: 'Sync cognition with source changes' }],
          },
        }],
      },
      suggestedActions: [
        { code: 'sync-cognition-with-source', label: 'Sync folder README with child structure changes', handbookId: 'skeleton', sourcePath: 'coggit/src' },
        { code: 'resolve-stale-cognition', label: 'After syncing, accept the pair as reviewed', operation: 'resolve', sourcePath: 'coggit/src' },
      ],
      handbookId: 'skeleton',
      triage: [
        {
          sourcePath: 'coggit/src', cognitionPath: 'coggit/src/README.md', nodeKind: 'folder', relation: 'own',
          issues: [], actions: [],
        },
        {
          sourcePath: 'coggit/src/views.ts', cognitionPath: 'coggit/src/views.ts.md', nodeKind: 'file', relation: 'descendant',
          issues: [],
          actions: [
            { code: 'sync-cognition-with-source', label: 'Sync cognition with source changes', handbookId: 'leaf', sourcePath: 'coggit/src/views.ts' },
            { code: 'resolve-stale-cognition', label: 'After syncing, accept the pair as reviewed', operation: 'resolve', sourcePath: 'coggit/src/views.ts' },
          ],
        },
      ],
    },
  })
  assert.equal(view.ownIssueCount, 1)
  assert.equal(view.descendantIssueCount, 1)
  // Own row carries the folder's sync-skeleton+resolve; descendant row carries
  // the descendant's sync-leaf+resolve — both tags defined once in the legends.
  assert.deepEqual(view.ownIssues[0].actionTags, ['sync-skeleton', 'resolve'])
  assert.deepEqual(view.descendantIssues[0], {
    sourcePath: 'coggit/src/views.ts',
    level: 'WARN',
    issueTags: ['stale-cognition'],
    actionTags: ['sync-leaf', 'resolve'],
    optionalActionTags: [],
  })
  assert.deepEqual(view.actionLegend.map(e => e.tag), ['sync-leaf', 'sync-skeleton', 'resolve'])
  assert.equal(view.actionLegend.find(e => e.tag === 'sync-leaf').role, 'recommended')
  // Top-level surfaceHints carry the own node's steps (folder sync-lead + resolve).
  assert.deepEqual(surfaceHints, [
    'Before authoring or editing this cognition, load skill "coggit-handbook-skeleton" with the skill tool.',
    'Call coggit_resolve with sourcePath="coggit/src".',
  ])
})



test('statusProjection hit routes descendant next steps only through triage (own-fresh folder)', async () => {
  const { statusProjection } = await import(fromLib('views'))
  const { view, surfaceHints } = statusProjection({
    found: true, sourcePath: 'coggit/src', nodeKind: 'folder', cognitionPath: 'coggit/src/README.md',
    project: null, status: 'stale', ownStatus: 'fresh', descendantStatus: 'stale',
    handbookId: 'skeleton', pathHints: [], suggestedActions: [],
    inspection: {
      sourcePath: 'coggit/src', cognitionPath: 'coggit/src/README.md', cognitionPresence: 'present',
      nodeKind: 'folder', status: 'stale', ownStatus: 'fresh', descendantStatus: 'stale',
      issueSummary: { total: 1, own: 0, descendant: 1 },
      subtreeIssues: {
        own: [],
        descendant: [{
          nodeId: 'n1', nodeKind: 'file', relativePath: 'coggit/src/views.ts', cognitionPath: 'coggit/src/views.ts.md',
          sourceUri: { scheme: 'file', authority: '', path: '/x/src/views.ts', query: '', fragment: '' },
          hasPairedCognition: true,
          issue: {
            diagnostic: { code: 'outdated-cognition', severity: 'warning', message: 'Stale cognition.' },
            actions: [{ label: 'Sync cognition with source changes' }],
          },
        }],
      },
      suggestedActions: [], handbookId: 'skeleton',
      triage: [
        {
          sourcePath: 'coggit/src/views.ts', cognitionPath: 'coggit/src/views.ts.md', nodeKind: 'file', relation: 'descendant',
          issues: [],
          actions: [
            { code: 'sync-cognition-with-source', label: 'Sync cognition with source changes', handbookId: 'leaf', sourcePath: 'coggit/src/views.ts' },
            { code: 'resolve-stale-cognition', label: 'After syncing, accept the pair as reviewed', operation: 'resolve', sourcePath: 'coggit/src/views.ts' },
          ],
        },
      ],
    },
  })
  // The own node is fresh: no own rows, and the top-level channel carries NO
  // resolve hint for the descendant — only the standing handbook hint.
  assert.equal(view.ownIssueCount, 0)
  assert.deepEqual(view.ownIssues, [])
  assert.deepEqual(surfaceHints, [
    'Before authoring or editing this cognition, load skill "coggit-handbook-skeleton" with the skill tool.',
  ])
  // The stale descendant is routed through its descendant row: its sync-leaf +
  // resolve tags come from the shared actionLegend (ADR 0015 descendant
  // routing; matches the CLI text surface, which also shows the row + legend).
  assert.equal(view.descendantIssueCount, 1)
  assert.deepEqual(view.descendantIssues[0], {
    sourcePath: 'coggit/src/views.ts',
    level: 'WARN',
    issueTags: ['stale-cognition'],
    actionTags: ['sync-leaf', 'resolve'],
    optionalActionTags: [],
  })
  assert.deepEqual(view.actionLegend.map(e => e.tag), ['sync-leaf', 'resolve'])
})


test('statusProjection hit with empty triage yields triage.entries = []', async () => {
  const { statusProjection } = await import(fromLib('views'))
  const { view } = statusProjection({
    found: true, sourcePath: '.', nodeKind: 'root', cognitionPath: 'README.md',
    project: null, status: 'fresh', ownStatus: 'fresh', descendantStatus: null,
    handbookId: null, pathHints: [], suggestedActions: [],
    inspection: {
      sourcePath: '.', cognitionPath: 'README.md', cognitionPresence: 'present',
      nodeKind: 'root', status: 'fresh', ownStatus: 'fresh', descendantStatus: null,
      issueSummary: { total: 0, own: 0, descendant: 0 },
      subtreeIssues: { own: [], descendant: [] },
      suggestedActions: [], handbookId: null,
      triage: [],
    },
  })
  assert.equal(view.ownIssueCount, 0)
  assert.equal(view.descendantIssueCount, 0)
  assert.deepEqual(view.ownIssues, [])
  assert.deepEqual(view.descendantIssues, [])
  assert.deepEqual(view.issueLegend, [])
  assert.deepEqual(view.actionLegend, [])
})



test('addView success keeps created/kind/cognitionPath and drops project/error internals', async () => {
  const { addView } = await import(fromLib('views'))
  const view = addView({
    success: true, created: false, kind: 'skeleton', sourcePath: 'src/app',
    cognitionPath: 'src_cognition/app/README.md',
    project: { label: 'ws', configUri: 'file:///x/.coggit/config.yaml', projectRootUri: 'file:///x', sourceRoot: 'src', cognitionRoot: 'src_cognition', sourcePathRule: 'src/**' },
    handbookId: 'skeleton',
    suggestedActions: [], error: null, pathHints: [],
  })
  assert.deepEqual(view, {
    success: true, created: false, kind: 'skeleton', sourcePath: 'src/app',
    cognitionPath: 'src_cognition/app/README.md',
  })
})

test('addView miss branch keeps the error + candidates and drops null-fillers', async () => {
  const { addView } = await import(fromLib('views'))
  const view = addView({
    success: false, created: null, kind: null, sourcePath: 'src/nope.ts', cognitionPath: null,
    project: null, handbookId: null,
    suggestedActions: [],
    error: { code: 'path-not-found', message: 'Path not found in any CogGit project.' },
    pathHints: ['src/note.ts'],
    pathMissMessage: 'Path not found in any CogGit project: src/nope.ts',
    pathHintMessage: 'You may mean one of these source-root-relative source paths.',
  })
  assert.deepEqual(view, {
    success: false, sourcePath: 'src/nope.ts',
    error: { code: 'path-not-found', message: 'Path not found in any CogGit project.' },
    pathHints: ['src/note.ts'],
  })
  assert.equal('created' in view, false, 'a failure omits the null created')
  assert.equal('kind' in view, false, 'a failure omits the null kind')
  assert.equal('cognitionPath' in view, false, 'a failure omits the null cognitionPath')
  assert.equal('pathMissMessage' in view, false)
  assert.equal('pathHintMessage' in view, false)
})

test('addProjection success keeps the handbook hint (no re-check); miss offers candidates', async () => {
  const { addProjection } = await import(fromLib('views'))
  const success = addProjection({
    success: true, created: true, kind: 'leaf', sourcePath: 'src/a.ts',
    cognitionPath: 'src_cognition/a.ts.md',
    project: null, handbookId: 'leaf',
    suggestedActions: [], error: null, pathHints: [],
  })
  assert.deepEqual(success.surfaceHints, [
    'Before authoring or editing this cognition, load skill "coggit-handbook-leaf" with the skill tool.',
  ])

  const miss = addProjection({
    success: false, created: null, kind: null, sourcePath: 'src/nope.ts', cognitionPath: null,
    project: null, handbookId: null,
    suggestedActions: [],
    error: { code: 'path-not-found', message: 'Path not found.' },
    pathHints: ['src/note.ts'],
  })
  assert.equal(miss.view.success, false)
  assert.deepEqual(miss.surfaceHints, [
    'Try one of these source-root-relative paths: "src/note.ts".',
  ])

  const otherError = addProjection({
    success: false, created: null, kind: null, sourcePath: 'src/app', cognitionPath: null,
    project: null, handbookId: null,
    suggestedActions: [{ code: 'recheck-status', label: 'Re-check the current status of this source path.', operation: 'status', sourcePath: 'src/app' }],
    error: { code: 'invalid-kind', message: 'Cannot create leaf cognition for a folder.' },
    pathHints: [],
  })
  assert.equal(otherError.view.success, false)
  assert.deepEqual(otherError.surfaceHints, [
    'Call coggit_status with sourcePath="src/app".',
  ])
})

test('resolveView success drops registry key/timestamp/error internals', async () => {
  const { resolveView } = await import(fromLib('views'))
  const view = resolveView({
    success: true, sourcePath: 'src/b.ts', cognitionPath: 'src_cognition/b.ts.md',
    project: { label: 'ws', configUri: 'file:///x/.coggit/config.yaml', projectRootUri: 'file:///x', sourceRoot: 'src', cognitionRoot: 'src_cognition', sourcePathRule: 'src/**' },
    sourceKey: 'src/b.ts', verificationTimeMs: 1724000000000,
    suggestedActions: [], error: null, pathHints: [],
  })
  assert.deepEqual(view, {
    success: true, sourcePath: 'src/b.ts', cognitionPath: 'src_cognition/b.ts.md',
  })
})

test('resolveView failure keeps the error and omits empty pathHints', async () => {
  const { resolveView } = await import(fromLib('views'))
  const view = resolveView({
    success: false, sourcePath: 'src/b.ts', cognitionPath: null,
    project: null, sourceKey: null, verificationTimeMs: null,
    suggestedActions: [{ code: 'recheck-status', label: 'Re-check the current status of this source path.', operation: 'status', sourcePath: 'src/b.ts' }],
    error: { code: 'content-changed', message: 'Source changed during resolve.' },
    pathHints: [],
  })
  assert.deepEqual(view, {
    success: false, sourcePath: 'src/b.ts',
    error: { code: 'content-changed', message: 'Source changed during resolve.' },
  })
  assert.equal('pathHints' in view, false, 'empty pathHints is omitted')
  assert.equal('cognitionPath' in view, false)
  assert.equal('sourceKey' in view, false)
  assert.equal('verificationTimeMs' in view, false)
})

test('resolveProjection non-miss failure keeps the re-check hint (re-inspect current state)', async () => {
  const { resolveProjection } = await import(fromLib('views'))
  const { view, surfaceHints } = resolveProjection({
    success: false, sourcePath: 'src/b.ts', cognitionPath: null,
    project: null, sourceKey: null, verificationTimeMs: null,
    suggestedActions: [{ code: 'recheck-status', label: 'Re-check the current status of this source path.', operation: 'status', sourcePath: 'src/b.ts' }],
    error: { code: 'content-changed', message: 'Source changed during resolve.' },
    pathHints: [],
  })
  assert.equal(view.success, false)
  assert.deepEqual(surfaceHints, [
    'Call coggit_status with sourcePath="src/b.ts".',
  ])
})

test('surfaceHints translates actions + handbook', async () => {
  const { surfaceHints } = await import(fromLib('views'))
  const hints = surfaceHints({
    suggestedActions: [{ code: 'x', label: 'Diagnose', operation: 'status', sourcePath: 'src/a.ts' }],
    handbookId: 'leaf',
  })
  assert.deepEqual(hints, [
    'Call coggit_status with sourcePath="src/a.ts".',
    'Before authoring or editing this cognition, load skill "coggit-handbook-leaf" with the skill tool.',
  ])
})

test('surfaceHints skips actions without an operation and empty fields', async () => {
  const { surfaceHints } = await import(fromLib('views'))
  const hints = surfaceHints({ suggestedActions: [{ code: 'x', label: 'No op' }] })
  assert.deepEqual(hints, [])
})

test('surfaceHints maps handbookId-only action (no operation) to skill hint', async () => {
  const { surfaceHints } = await import(fromLib('views'))
  const hints = surfaceHints({
    suggestedActions: [{ code: 'sync-cognition', label: 'Sync', handbookId: 'leaf', sourcePath: 'src/stale.ts' }],
  })
  assert.deepEqual(hints, [
    'Before authoring or editing this cognition, load skill "coggit-handbook-leaf" with the skill tool.',
  ])
})

test('surfaceHints suppresses top-level handbookId when a step-local action carries the same handbookId', async () => {
  const { surfaceHints } = await import(fromLib('views'))
  const hints = surfaceHints({
    suggestedActions: [
      { code: 'sync-cognition', label: 'Sync', handbookId: 'leaf', sourcePath: 'src/stale.ts' },
      { code: 'resolve-stale', label: 'Resolve', operation: 'resolve', sourcePath: 'src/stale.ts' },
    ],
    handbookId: 'leaf',
  })
  // Only ONE handbook hint (from the sync action); the top-level is suppressed.
  assert.deepEqual(hints, [
    'Before authoring or editing this cognition, load skill "coggit-handbook-leaf" with the skill tool.',
    'Call coggit_resolve with sourcePath="src/stale.ts".',
  ])
})

test('surfaceHints keeps top-level handbookId when step-local action has a different handbookId', async () => {
  const { surfaceHints } = await import(fromLib('views'))
  const hints = surfaceHints({
    suggestedActions: [
      { code: 'sync-cognition', label: 'Sync', handbookId: 'leaf', sourcePath: 'src/stale.ts' },
    ],
    handbookId: 'skeleton',
  })
  // Both hints appear: step-local leaf + top-level skeleton.
  assert.deepEqual(hints, [
    'Before authoring or editing this cognition, load skill "coggit-handbook-leaf" with the skill tool.',
    'Before authoring or editing this cognition, load skill "coggit-handbook-skeleton" with the skill tool.',
  ])
})
