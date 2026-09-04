// resolveWorkspacePath unit tests: the CogGit init tab's workspace-target
// resolution. Imports the BUILT `lib/` artifact (pure ESM — type-only imports
// are erased), so it needs no React render machinery or `@deepseek-ai/*`
// junctions. The component-level wiring (useSessions/useWorkspaces props) has
// no vitest infra in this package; see the README manual acceptance path.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { fromLib } from './helpers.mjs'

const { resolveWorkspacePath } = await import(fromLib('client/workspace-resolve'))

/** Minimal WorkspaceView fixture. */
function workspace(workspaceId, path, sessionIds = [], updatedAt = '2026-01-01T00:00:00.000Z') {
  return { workspaceId, path, title: path, sessionIds, createdAt: '2026-01-01T00:00:00.000Z', updatedAt }
}

/** Minimal SessionSummary fixture. */
function session(id, updatedAt) {
  return { id, displayTitle: id, running: false, updatedAt }
}

/** Minimal SessionListState fixture. */
function sessions(current, byId, phase = 'ready') {
  return { ids: Object.keys(byId), byId, current, phase, subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined }
}

/** Minimal WorkspaceSnapshot fixture. */
function workspaces(items, phase = 'ready') {
  return { items, archivedSessionIds: [], state: 'idle', phase, error: null }
}

test('selected session wins over a more recently active workspace', () => {
  const byId = { s1: session('s1', 100), s2: session('s2', 900) }
  const state = workspaces([
    workspace('w-old', 'C:/project-a', ['s1'], '2026-01-01T00:00:00.000Z'),
    workspace('w-new', 'C:/project-b', ['s2'], '2026-01-02T00:00:00.000Z'),
  ])
  assert.equal(resolveWorkspacePath(state, sessions('s1', byId)), 'C:/project-a')
})

test('selected session without workspace membership falls back to the most recently active workspace', () => {
  const byId = { s1: session('s1', 100), s2: session('s2', 900) }
  const state = workspaces([
    workspace('w-a', 'C:/project-a', ['s2'], '2026-01-01T00:00:00.000Z'),
    workspace('w-b', 'C:/project-b', [], '2026-01-03T00:00:00.000Z'),
  ])
  // s1 is selected but not accounted to any workspace; w-b is newer than
  // w-a's session, so w-b wins the recent fallback.
  assert.equal(resolveWorkspacePath(state, sessions('s1', byId)), 'C:/project-b')
})

test('no selected session resolves the most recently active workspace', () => {
  const byId = { s1: session('s1', 100), s2: session('s2', 900) }
  const state = workspaces([
    workspace('w-a', 'C:/project-a', ['s1'], '2026-01-01T00:00:00.000Z'),
    workspace('w-b', 'C:/project-b', ['s2'], '2026-01-02T00:00:00.000Z'),
  ])
  assert.equal(resolveWorkspacePath(state, sessions(undefined, byId)), 'C:/project-b')
})

test('a workspace with no sessions uses its createdAt as recency', () => {
  const byId = { s1: session('s1', 100) }
  const state = workspaces([
    workspace('w-a', 'C:/project-a', ['s1'], '2026-01-01T00:00:00.000Z'),
    // No sessions and a newer createdAt than w-a's session activity.
    workspace('w-empty', 'C:/project-empty', [], '2026-06-01T00:00:00.000Z'),
  ])
  assert.equal(resolveWorkspacePath(state, sessions(undefined, byId)), 'C:/project-empty')
})

test('equal recency keeps host order (first workspace wins)', () => {
  // Session updatedAt is epoch-ms; a workspace's createdAt is an ISO instant
  // parsed to the same scale, so an exact tie is reachable.
  const instant = Date.parse('2026-01-01T00:00:00.000Z')
  const byId = { s1: session('s1', instant) }
  const state = workspaces([
    workspace('w-first', 'C:/project-first', ['s1'], new Date(instant).toISOString()),
    workspace('w-second', 'C:/project-second', [], new Date(instant).toISOString()),
  ])
  assert.equal(resolveWorkspacePath(state, sessions(undefined, byId)), 'C:/project-first')
})

test('empty lists resolve undefined (server-cwd fallback)', () => {
  assert.equal(resolveWorkspacePath(workspaces([]), sessions(undefined, {})), undefined)
})

test('pending phases skip the recent fallback (nothing settles before both baselines)', () => {
  const byId = { s1: session('s1', 100) }
  const state = workspaces([workspace('w-a', 'C:/project-a', ['s1'])], 'pending')
  assert.equal(resolveWorkspacePath(state, sessions(undefined, byId, 'pending')), undefined)
  // The selected-session branch still works even while lists are pending.
  assert.equal(resolveWorkspacePath(state, sessions('s1', byId, 'pending')), 'C:/project-a')
})
