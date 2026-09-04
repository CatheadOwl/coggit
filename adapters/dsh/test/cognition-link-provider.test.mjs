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

test('resolveCognitionLink projects a fresh hit to { href, meta } with stale false', async () => {
  const { resolveCognitionLink } = await import(fromLib('cognition-link-provider'))
  assert.deepEqual(resolveCognitionLink(hit({ ownStatus: 'fresh' })), {
    href: 'src/app/main.ts.md',
    meta: { stale: 'false' },
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
      async statusWithSnapshot(_cwd, sourcePath) {
        return hit({ cognitionPath: `cog/${sourcePath}`, sourcePath })
      },
    }
    const provider = createCognitionLinkProvider(coggit)

    const turn1 = { cwd: root, turnId: 't1' }
    const r1 = await provider.resolve({ path: { path: 'a.ts' }, input: turn1 })
    const r2 = await provider.resolve({ path: { path: 'b.ts' }, input: turn1 })
    assert.equal(buildCount, 1, 'one turn builds the snapshot exactly once')
    assert.deepEqual(r1, { href: 'cog/a.ts', meta: { stale: 'false' } })
    assert.deepEqual(r2, { href: 'cog/b.ts', meta: { stale: 'false' } })

    const turn2 = { cwd: root, turnId: 't2' }
    const r3 = await provider.resolve({ path: { path: 'a.ts' }, input: turn2 })
    assert.equal(buildCount, 2, 'a new turn rebuilds the snapshot')
    assert.deepEqual(r3, { href: 'cog/a.ts', meta: { stale: 'false' } })
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
  assert.equal(registered.kind, 'cognition-link')
  assert.equal(registered.priority, 10)
  assert.equal(typeof registered.resolve, 'function')
})
