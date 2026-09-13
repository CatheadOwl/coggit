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

test('apply registers the guidance sections (overview + cognition-link directive)', async () => {
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
  assert.deepEqual(
    sections.map(s => [s.name, s.order]),
    [['coggit:overview', 117], ['coggit:cognition-link', 118]],
  )
  for (const section of sections) {
    assert.equal(typeof section.text, 'function', `${section.name} text is a lazy provider, not a static string`)
  }
})

test('cognition-link section stays empty unless cognitionLinkDirective is on', async () => {
  const mod = await import(fromLib('index'))
  const collect = []
  const makeCtx = () => ({
    plugin: async () => {},
    skills: { register() {} },
    tools: { register() {} },
    systemPrompt: { section(section) { collect.push(section) } },
    inject() {},
    on() {},
    get(name) { if (name === 'coggit') return {}; throw new Error('unexpected ctx.get(' + name + ')') },
  })

  const configured = await makeTempDir('coggit-directive')
  try {
    await createInitializedProject(configured)
    const context = { agent: { session: { header: { cwd: configured } } } }

    await mod.apply(makeCtx(), {})
    const offText = collect.find(s => s.name === 'coggit:cognition-link').text
    assert.equal(offText(context), '', 'directive off (default) → empty section')

    collect.length = 0
    await mod.apply(makeCtx(), { cognitionLinkDirective: true })
    const onText = collect.find(s => s.name === 'coggit:cognition-link').text
    assert.equal(onText(context), mod.COGNITION_LINK_DIRECTIVE, 'directive on → the directive text renders')
  } finally {
    await removeTempDir(configured)
  }
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

test('statusText hit renders core status text with trailing hints (stale leaf)', async () => {
  const { statusText } = await import(fromLib('views'))
  const text = statusText({
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
  // The hit text is core's canonical agent presentation (the same renderer
  // the CLI/MCP deliver), plus this surface's trailing hint lines.
  assert.ok(text.includes('Status: Stale'), 'aggregated status header')
  assert.ok(text.includes('Source: coggit/src/views.ts'))
  assert.ok(text.includes('Cognition: coggit/src/views.ts.md'))
  assert.ok(text.includes('Legend:'), 'issue legend renders once')
  assert.ok(text.includes('WARN'), 'row severity level')
  assert.ok(/stale-cognition\s*\|/.test(text), 'issue tag in the own row')
  assert.ok(text.includes('actions=sync-leaf,resolve'), 'row action channel')
  assert.ok(text.includes('Own issues: 1'))
  assert.ok(text.includes('Descendant issues: 0'))
  // Trailing hints: one blank line, then the own-node steps (handbook lead,
  // resolve trail — status-surface role contract).
  assert.ok(text.endsWith(
    '\n\nBefore authoring or editing this cognition, load skill "coggit-handbook-leaf" with the skill tool.\nCall coggit_resolve with sourcePath="coggit/src/views.ts".',
  ), 'stale hit ends with the handbook + resolve hints after a blank line')
})



test('statusText miss renders core miss text with fuzzy candidates, no imperative hints', async () => {
  const { statusText } = await import(fromLib('views'))
  const text = statusText({
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
  // Miss text is core's renderPathMissText: not-found line + lead-in + the
  // backtick-wrapped candidate list. No status/issue sections exist on a miss.
  assert.equal(text, 'No source path matched.\nDid you mean:\nTry: `src/note.ts`')
  assert.equal(text.includes('Call coggit_'), false, 'a miss carries no imperative hint')
})

test('statusText miss without candidates falls back to core default miss line', async () => {
  const { statusText } = await import(fromLib('views'))
  const text = statusText({
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
  assert.equal(text, 'Path not found in any CogGit project: zzz/unknown.ts')
})

test('statusText hit filters the optional add action and emits no handbook hint (role contract)', async () => {
  const { statusText } = await import(fromLib('views'))
  const text = statusText({
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
    suggestedActions: [{ code: 'create-cognition', label: 'Create cognition file', operation: 'add', role: 'optional-on-demand', sourcePath: 'uncognized.ts' }],
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
      suggestedActions: [{ code: 'create-cognition', label: 'Create cognition file', operation: 'add', role: 'optional-on-demand', sourcePath: 'uncognized.ts' }],
      handbookId: 'leaf',
      triage: [],
    },
  })
  // Status-surface role contract (issue 20260906-1916): the `missing` fact is the on-demand
  // affordance — the materialization line renders, but no imperative add hint
  // and no premature handbook hint on the status face (handbook addressing
  // starts at the add success result).
  assert.ok(text.includes('Cognition: Not created (add on demand)'))
  assert.equal(text.includes('coggit_add'), false, 'no imperative add hint')
  assert.equal(text.includes('coggit-handbook'), false, 'no premature handbook hint')
  assert.equal(text.includes('Call coggit_'), false, 'no trailing hints section')
})

test('statusText hit on a fresh node emits no hints', async () => {
  const { statusText } = await import(fromLib('views'))
  const text = statusText({
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
  // Fresh node: no actions, and the status face never emits the top-level
  // handbook hint (issue 20260906-1916) — no trailing hints section.
  assert.ok(text.includes('Status: Fresh'))
  assert.equal(text.includes('coggit-handbook'), false)
  assert.equal(text.includes('Call coggit_'), false)
})

test('statusText hit maps the core resolve next step to coggit_resolve', async () => {
  const { statusText } = await import(fromLib('views'))
  const text = statusText({
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
  assert.ok(text.includes('Status: Stale'))
  // Top-level handbookId is suppressed: the sync action already carries handbookId='leaf'.
  assert.ok(text.endsWith(
    '\n\nBefore authoring or editing this cognition, load skill "coggit-handbook-leaf" with the skill tool.\nCall coggit_resolve with sourcePath="foo.ts".',
  ))
})

test('statusText hit with null status and no actions does NOT prepend coggit_add', async () => {
  const { statusText } = await import(fromLib('views'))
  const text = statusText({
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
  assert.equal(text.includes('coggit_add'), false, 'status null alone is not a create-cognition signal')
})

test('statusText hit includes the triage rows with own hints (stale folder + stale descendant)', async () => {
  const { statusText } = await import(fromLib('views'))
  const text = statusText({
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
  assert.ok(text.includes('Own issues: 1'))
  assert.ok(text.includes('Descendant issues: 1'))
  // Own row carries the folder's sync-skeleton+resolve; descendant row carries
  // the descendant's sync-leaf+resolve — both tags defined once in the legend.
  assert.ok(/actions=sync-skeleton,resolve/.test(text), 'own row action channel')
  const descendantRow = text.split('\n').find(l => l.includes('source=coggit/src/views.ts'))
  assert.ok(descendantRow, 'descendant row renders')
  assert.ok(descendantRow.includes('actions=sync-leaf,resolve'), 'descendant row action channel')
  // Top-level trailing hints carry the own node's steps (folder sync-lead + resolve).
  assert.ok(text.endsWith(
    '\n\nBefore authoring or editing this cognition, load skill "coggit-handbook-skeleton" with the skill tool.\nCall coggit_resolve with sourcePath="coggit/src".',
  ))
})



test('statusText hit routes descendant next steps only through the rows (own-fresh folder)', async () => {
  const { statusText } = await import(fromLib('views'))
  const text = statusText({
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
  // The own node is fresh: no own rows, and the trailing hints carry NO
  // resolve hint for the descendant and NO top-level handbook hint (issue
  // 20260906-1916: the status face never emits the top-level handbookId —
  // handbook addressing belongs to the stale step-local sync action or the
  // add success result, not to a fresh own node).
  assert.ok(text.includes('Own issues: 0'))
  assert.equal(text.includes('Call coggit_'), false, 'no own-node imperative hints')
  assert.equal(text.includes('coggit-handbook'), false)
  // The stale descendant is routed through its descendant row: its sync-leaf +
  // resolve tags come from the shared action legend (core's descendant
  // routing; matches the CLI/MCP text surface, which also shows row + legend).
  assert.ok(text.includes('Descendant issues: 1'))
  const descendantRow = text.split('\n').find(l => l.includes('source=coggit/src/views.ts'))
  assert.ok(descendantRow, 'descendant row renders')
  assert.ok(descendantRow.includes('actions=sync-leaf,resolve'))
})

test('statusText hit on an all-fresh root renders plain counts and no hints', async () => {
  const { statusText } = await import(fromLib('views'))
  const text = statusText({
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
  assert.ok(text.includes('Own issues: 0'))
  assert.ok(text.includes('Descendant issues: 0'))
  assert.equal(text.includes('Legend:'), false)
  assert.equal(text.includes('Actions:'), false)
  assert.equal(text.includes('Call coggit_'), false)
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
