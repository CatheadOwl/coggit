// CoggitService integration test against a REAL temp fixture: construct a real
// cordis Context, instantiate the actual CoggitService (super(ctx, 'coggit')),
// initialize a CogGit project on disk, then run status/add/resolve and assert
// the adapter projects real SDK results. No dsh server; seconds to run.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'

import { createInitializedProject, makeTempDir, removeTempDir } from './helpers.mjs'

// Import the real cordis Context via the plugin's junction.
const { Context } = await import('@deepseek-ai/cordis')
const { CoggitService } = await import('../lib/types/service.js')

test('CoggitService.status discovers a real project and reports the root', async () => {
  const dir = await makeTempDir('coggit-svc-status')
  try {
    await createInitializedProject(dir)
    const ctx = new Context()
    const service = new CoggitService(ctx, {})
    const result = await service.status(dir, '.')
    assert.equal(result.found, true)
    assert.equal(result.nodeKind, 'root')
    assert.ok(result.inspection, 'status must carry canonical inspection')
  } finally {
    await removeTempDir(dir)
  }
})

test('status on a missing path reports path-not-found with an error issue', async () => {
  const dir = await makeTempDir('coggit-svc-miss')
  try {
    await createInitializedProject(dir)
    const ctx = new Context()
    const service = new CoggitService(ctx, {})
    const result = await service.status(dir, 'src/nope.ts')
    assert.equal(result.found, false)
    assert.equal(result.issueCount, 1)
    assert.equal(result.issues[0].code, 'path-not-found')
  } finally {
    await removeTempDir(dir)
  }
})

test('status on an uninitialized workspace reports no projects (found=false)', async () => {
  const dir = await makeTempDir('coggit-svc-empty')
  try {
    const ctx = new Context()
    const service = new CoggitService(ctx, {})
    const result = await service.status(dir, '.')
    assert.equal(result.found, false)
  } finally {
    await removeTempDir(dir)
  }
})

test('add creates a cognition doc and carries no re-check on success', async () => {
  const dir = await makeTempDir('coggit-svc-add')
  try {
    const { sourceDir, cognitionRoot } = await createInitializedProject(dir)
    await mkdir(sourceDir, { recursive: true })
    await writeFile(join(sourceDir, 'a.ts'), 'export const a = 1\n', 'utf8')

    const ctx = new Context()
    const service = new CoggitService(ctx, {})
    const result = await service.add(dir, 'a.ts', { kind: 'leaf' })
    assert.equal(result.success, true, JSON.stringify(result))
    assert.equal(result.kind, 'leaf')
    // success is self-confirming: no re-check action, handbookId is the next step
    assert.deepEqual(result.suggestedActions, [])
    assert.equal(result.handbookId, 'leaf')
    // the cognition doc is written on disk (src/a.ts -> src_cognition/a.ts.md)
    const cognitionPath = join(dir, cognitionRoot, 'a.ts.md')
    await access(cognitionPath)
    assert.ok(result.cognitionPath, 'add must return the cognition path')
  } finally {
    await removeTempDir(dir)
  }
})

test('resolve accepts a stale pair and re-records it', async () => {
  const dir = await makeTempDir('coggit-svc-resolve')
  try {
    const { sourceDir } = await createInitializedProject(dir)
    await writeFile(join(sourceDir, 'b.ts'), 'export const b = 2\n', 'utf8')

    const ctx = new Context()
    const service = new CoggitService(ctx, {})
    // First add creates the pair (fresh).
    const add = await service.add(dir, 'b.ts', { kind: 'leaf' })
    assert.equal(add.success, true, JSON.stringify(add))

    // Touch the source to make the pair stale, then resolve.
    await writeFile(join(sourceDir, 'b.ts'), 'export const b = 3\n', 'utf8')
    const resolve = await service.resolve(dir, 'b.ts')
    assert.equal(resolve.success, true, JSON.stringify(resolve))
    assert.deepEqual(resolve.suggestedActions, [])
  } finally {
    await removeTempDir(dir)
  }
})

test('buildSnapshot + statusWithSnapshot matches N independent status calls', async () => {
  const dir = await makeTempDir('coggit-svc-snapshot')
  try {
    const { sourceDir } = await createInitializedProject(dir)
    await writeFile(join(sourceDir, 'a.ts'), 'export const a = 1\n', 'utf8')
    await writeFile(join(sourceDir, 'b.ts'), 'export const b = 2\n', 'utf8')

    const ctx = new Context()
    const service = new CoggitService(ctx, {})
    // Give a.ts a paired cognition so its status carries a cognitionPath.
    await service.add(dir, 'a.ts', { kind: 'leaf' })

    const snapshot = await service.buildSnapshot(dir)
    for (const sourcePath of ['a.ts', 'b.ts', '.', 'src/nope.ts']) {
      const batch = await service.statusWithSnapshot(dir, sourcePath, snapshot)
      const independent = await service.status(dir, sourcePath)
      assert.equal(batch.found, independent.found, `found mismatch for ${sourcePath}`)
      assert.equal(batch.sourcePath, independent.sourcePath, `sourcePath mismatch for ${sourcePath}`)
      assert.equal(batch.cognitionPath, independent.cognitionPath, `cognitionPath mismatch for ${sourcePath}`)
      assert.equal(batch.ownStatus, independent.ownStatus, `ownStatus mismatch for ${sourcePath}`)
    }
  } finally {
    await removeTempDir(dir)
  }
})

test('projects are discovered and cached independently per workspace root', async () => {
  const a = await makeTempDir('coggit-svc-a')
  const b = await makeTempDir('coggit-svc-b')
  try {
    await createInitializedProject(a)
    await createInitializedProject(b)
    const ctx = new Context()
    const service = new CoggitService(ctx, {})
    const ra = await service.status(a, '.')
    const rb = await service.status(b, '.')
    assert.equal(ra.found, true)
    assert.equal(rb.found, true)
    // distinct roots yield distinct project contexts
    assert.notEqual(ra.project?.configUri, rb.project?.configUri)
  } finally {
    await removeTempDir(a)
    await removeTempDir(b)
  }
})
