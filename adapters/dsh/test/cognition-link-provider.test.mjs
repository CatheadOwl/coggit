// cognition-link provider tests: pure projection + snapshot-per-turn behavior +
// soft-dependency registration. Exercises the BUILT `lib/` artifacts, so no
// Cordis process and no dsh server.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createInitializedProject, fromLib, makeTempDir, removeTempDir } from './helpers.mjs'

function hit({ ownStatus = 'fresh', presence = 'present', cognitionPath = 'src/app/main.ts.md' } = {}) {
  const status = ownStatus ?? null
  return {
    found: true,
    sourcePath: 'src/app/main.ts',
    sourceUri: null,
    nodeKind: 'file',
    project: null,
    cognitionPath,
    cognitionUri: null,
    status,
    ownStatus,
    descendantStatus: null,
    staleAction: null,
    issueCount: 0,
    ownIssueCount: 0,
    descendantIssueCount: 0,
    issues: [],
    suggestedActions: [],
    handbookId: 'leaf',
    node: null,
    pathHints: [],
    inspection: {
      sourcePath: 'src/app/main.ts',
      cognitionPath,
      cognitionPresence: presence,
      nodeKind: 'file',
      status,
      ownStatus,
      descendantStatus: null,
      issueSummary: { total: 0, own: 0, descendant: 0 },
      subtreeIssues: { own: [], descendant: [] },
      suggestedActions: [],
      triage: [],
      handbookId: 'leaf',
    },
  }
}

function miss() {
  return {
    found: false,
    sourcePath: 'src/never.ts',
    sourceUri: null,
    nodeKind: null,
    project: null,
    cognitionPath: null,
    cognitionUri: null,
    status: null,
    ownStatus: null,
    descendantStatus: null,
    staleAction: null,
    issueCount: 1,
    ownIssueCount: 0,
    descendantIssueCount: 0,
    issues: [],
    suggestedActions: [],
    handbookId: null,
    node: null,
    pathHints: [],
  }
}

test('resolveCognitionLink projects a fresh hit to { href } — steady-state silence means no meta key', async () => {
  const { resolveCognitionLink } = await import(fromLib('cognition-link-provider'))
  assert.deepEqual(resolveCognitionLink(hit({ ownStatus: 'fresh' })), {
    href: 'src/app/main.ts.md',
  })
})

test('resolveCognitionLink flags stale as a meta marker', async () => {
  const { resolveCognitionLink } = await import(fromLib('cognition-link-provider'))
  assert.deepEqual(resolveCognitionLink(hit({ ownStatus: 'stale' })), {
    href: 'src/app/main.ts.md',
    meta: { stale: 'true' },
  })
})

test('resolveCognitionLink collapses source miss, missing, and not-applicable to undefined', async () => {
  const { resolveCognitionLink } = await import(fromLib('cognition-link-provider'))
  assert.equal(resolveCognitionLink(miss()), undefined)
  assert.equal(resolveCognitionLink(hit({ presence: 'missing' })), undefined)
  assert.equal(resolveCognitionLink(hit({ presence: 'not-applicable' })), undefined)
})

function uri(path) {
  return { scheme: 'test', authority: '', path, query: '', fragment: '' }
}

function separatedRoot() {
  return {
    id: 'root',
    label: 'root',
    workspaceFolder: { uri: uri('/workspace'), name: 'workspace', index: 0 },
    configUri: uri('/workspace/.coggit/config.yaml'),
    projectRootUri: uri('/workspace'),
    sourceRootUri: uri('/workspace/codebase'),
    cognitionRootUri: uri('/workspace/codebase_cognition'),
  }
}

test('createCognitionLinkProvider builds one snapshot per turn and reuses it across paths', async () => {
  const { createCognitionLinkProvider } = await import(fromLib('cognition-link-provider'))
  const root = await makeTempDir('coggit-link')
  try {
    await createInitializedProject(root)
    let buildCount = 0
    const coggit = {
      async buildSnapshot() {
        buildCount += 1
        return { build: buildCount }
      },
      async roots() { return [separatedRoot()] },
      async statusWithSnapshot(_cwd, sourcePath) {
        return hit({ cognitionPath: `cog/${sourcePath}`, sourcePath })
      },
    }
    const provider = createCognitionLinkProvider(coggit)

    const turn1 = { cwd: root, turnId: 't1' }
    const r1 = await provider.resolve({ path: { path: 'a.ts' }, input: turn1 })
    const r2 = await provider.resolve({ path: { path: 'b.ts' }, input: turn1 })
    assert.equal(buildCount, 1, 'one turn builds the snapshot exactly once')
    assert.deepEqual(r1, { href: 'cog/a.ts' })
    assert.deepEqual(r2, { href: 'cog/b.ts' })

    const turn2 = { cwd: root, turnId: 't2' }
    const r3 = await provider.resolve({ path: { path: 'a.ts' }, input: turn2 })
    assert.equal(buildCount, 2, 'a new turn rebuilds the snapshot')
    // Steady state (same pair state as the last render): silent — the
    // snapshot is still rebuilt per turn, but nothing new is said.
    assert.equal(r3, undefined)
  } finally {
    await removeTempDir(root)
  }
})

test('createCognitionLinkProvider short-circuits unconfigured workspaces without a snapshot build', async () => {
  const { createCognitionLinkProvider } = await import(fromLib('cognition-link-provider'))
  const root = await makeTempDir('coggit-link-noconfig')
  try {
    let buildCount = 0
    const coggit = {
      async buildSnapshot() { buildCount += 1; return {} },
      async roots() { return [] },
      async statusWithSnapshot() { throw new Error('must not be called on an unconfigured workspace') },
    }
    const provider = createCognitionLinkProvider(coggit)
    const out = await provider.resolve({ path: { path: 'a.ts' }, input: { cwd: root, turnId: 't1' } })
    assert.equal(out, undefined)
    assert.equal(buildCount, 0, 'no snapshot build on an unconfigured workspace')
  } finally {
    await removeTempDir(root)
  }
})

test('touchSubjects: cold cache projects nothing; warmed cache maps both sides onto paired sources', async () => {
  const { createCognitionLinkProvider } = await import(fromLib('cognition-link-provider'))
  const root = await makeTempDir('coggit-link-touch')
  try {
    await createInitializedProject(root)
    let ownStatus = 'fresh'
    const coggit = {
      async buildSnapshot() { return {} },
      async roots() { return [separatedRoot()] },
      async statusWithSnapshot(_cwd, sourcePath) { return hit({ ownStatus, sourcePath, cognitionPath: `cog/${sourcePath}` }) },
    }
    const provider = createCognitionLinkProvider(coggit)

    // Cold cwd: no roots warmed yet, nothing to project (documented degradation).
    assert.deepEqual(provider.touchSubjects('codebase/a/b.ts.md', { cwd: root }), [])

    // Warm the cache via one resolve.
    await provider.resolve({ path: { path: 'codebase/a/b.ts' }, input: { cwd: root, turnId: 't1' } })

    // Cognition-side touch reverse-projects to the paired source.
    assert.deepEqual(provider.touchSubjects('codebase_cognition/a/b.ts.md', { cwd: root }), ['codebase/a/b.ts'])
    assert.deepEqual(provider.touchSubjects('codebase_cognition/x/README.md', { cwd: root }), ['codebase/x'])
    // Free-form cognition docs have no pairing: no subject.
    assert.deepEqual(provider.touchSubjects('codebase_cognition/CODE_MAP.md', { cwd: root }), [])
    // Source-side touch keeps the path itself as the subject (prompt-side mirror).
    assert.deepEqual(provider.touchSubjects('codebase/a/b.ts', { cwd: root }), ['codebase/a/b.ts'])
    // Another cwd stays isolated: no union contamination across projects.
    assert.deepEqual(provider.touchSubjects('codebase_cognition/a/b.ts.md', { cwd: 'D:/elsewhere' }), [])
    assert.equal(ownStatus, 'fresh')
  } finally {
    await removeTempDir(root)
  }
})

test('rendering policy: self-edit reconciles silently, steady state is silent, a flip re-emits with updated marker', async () => {
  const { createCognitionLinkProvider } = await import(fromLib('cognition-link-provider'))
  const root = await makeTempDir('coggit-link-render')
  try {
    await createInitializedProject(root)
    let ownStatus = 'fresh'
    const coggit = {
      async buildSnapshot() { return {} },
      async roots() { return [separatedRoot()] },
      async statusWithSnapshot(_cwd, sourcePath) { return hit({ ownStatus, sourcePath, cognitionPath: `cog/${sourcePath}` }) },
    }
    const provider = createCognitionLinkProvider(coggit)
    const subject = 'codebase/a/b.ts'

    // never -> fresh: plain link, no meta (fresh is the default, silence).
    const first = await provider.resolve({ path: { path: subject }, input: { cwd: root, turnId: 't1' } })
    assert.deepEqual(first, { href: `cog/${subject}` })

    // Same state again (new turn, e.g. re-mention): steady state, silent.
    const steady = await provider.resolve({ path: { path: subject }, input: { cwd: root, turnId: 't2' } })
    assert.equal(steady, undefined)

    // The agent edits the source: reconcile, never narrate.
    ownStatus = 'stale'
    const selfEdit = await provider.resolve({
      path: { path: subject, origin: 'touch', touchTool: 'edit' },
      input: { cwd: root, turnId: 't3' },
    })
    assert.equal(selfEdit, undefined)

    // Steady again after the reconcile (record was refreshed to stale).
    const steadyStale = await provider.resolve({
      path: { path: subject, origin: 'touch', touchTool: 'read' },
      input: { cwd: root, turnId: 't4' },
    })
    assert.equal(steadyStale, undefined)

    // External change flips the state: one item again, marked updated. The
    // fresh side writes no `stale` key — `updated` alone carries the change.
    ownStatus = 'fresh'
    const flipped = await provider.resolve({
      path: { path: subject, origin: 'touch', touchTool: 'read' },
      input: { cwd: root, turnId: 't5' },
    })
    assert.deepEqual(flipped, { href: `cog/${subject}`, meta: { updated: 'true' } })
  } finally {
    await removeTempDir(root)
  }
})

test('registerCognitionLinkProvider registers a declarative provider via ctx.inject', async () => {
  const { registerCognitionLinkProvider } = await import(fromLib('cognition-link-provider'))
  let registered
  const ctx = {
    get(name) {
      if (name === 'coggit') {
        return { buildSnapshot: async () => ({}), statusWithSnapshot: async () => miss() }
      }
      throw new Error('unexpected ctx.get(' + name + ')')
    },
    inject(deps, callback) {
      assert.deepEqual(deps, ['promptMiddleware'])
      callback({ promptMiddleware: { registerRelates: (provider) => { registered = provider } } })
    },
  }
  registerCognitionLinkProvider(ctx)
  assert.ok(registered, 'registerRelates must be called')
  assert.equal(registered.name, 'cognition-link-enricher')
  assert.equal(typeof registered.description, 'string')
  assert.ok(registered.description.length > 0)
  assert.equal(registered.kind, 'cognition-link')
  assert.equal(registered.priority, 10)
  assert.deepEqual(registered.sources, ['prompt', 'touch'])
  assert.equal(typeof registered.touchSubjects, 'function')
  assert.equal(typeof registered.resolve, 'function')
})
