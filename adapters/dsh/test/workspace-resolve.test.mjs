// resolveWorkspacePath unit tests: the CogGit init tab's workspace-target
// resolution. Imports the BUILT `lib/` artifact (pure ESM — type-only imports
// are erased), so it needs no React render machinery or `@deepseek-ai/*`
// junctions. The component-level wiring (useSessions/useWorkspaces props) has
// no vitest infra in this package; see the README manual acceptance path.
//
// Semantics follow the host 0.1.6-alpha.2 session-ownership refactor: the
// client-side global "current session" is gone, so resolution is the most
// recently active workspace only (latest session updatedAt per workspace,
// host order tie-break, createdAt when a workspace has no sessions).

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
function sessions(byId, phase = 'ready') {
  return { ids: Object.keys(byId), byId, phase, subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined }
}

/** Minimal WorkspaceSnapshot fixture. */
function workspaces(items, phase = 'ready') {
  return { items, archivedSessionIds: [], state: 'idle', phase, error: null }
}

test('the most recently active workspace wins regardless of list order', () => {
  const byId = { s1: session('s1', 100), s2: session('s2', 900) }
  const state = workspaces([
    workspace('w-old', 'C:/project-a', ['s1'], '2026-01-01T00:00:00.000Z'),
    workspace('w-new', 'C:/project-b', ['s2'], '2026-01-02T00:00:00.000Z'),
  ])
  assert.equal(resolveWorkspacePath(state, sessions(byId)), 'C:/project-b')
})

test('a workspace with no sessions uses its createdAt as recency', () => {
  const byId = { s1: session('s1', 100) }
  const state = workspaces([
    workspace('w-a', 'C:/project-a', ['s1'], '2026-01-01T00:00:00.000Z'),
    // No sessions and a newer createdAt than w-a's session activity.
    workspace('w-empty', 'C:/project-empty', [], '2026-06-01T00:00:00.000Z'),
  ])
  assert.equal(resolveWorkspacePath(state, sessions(byId)), 'C:/project-empty')
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
  assert.equal(resolveWorkspacePath(state, sessions(byId)), 'C:/project-first')
})

test('sessions not accounted to any workspace do not skew recency', () => {
  // s1 (ts 5000) belongs to no workspace; w-a's only session is older, so
  // w-a's recency is its own session — the orphan session is invisible.
  const byId = { s1: session('s1', 5000), s2: session('s2', 100) }
  const state = workspaces([
    workspace('w-a', 'C:/project-a', ['s2'], '2026-01-01T00:00:00.000Z'),
    workspace('w-b', 'C:/project-b', [], '2026-01-03T00:00:00.000Z'),
  ])
  assert.equal(resolveWorkspacePath(state, sessions(byId)), 'C:/project-b')
})

test('empty lists resolve undefined (server-cwd fallback)', () => {
  assert.equal(resolveWorkspacePath(workspaces([]), sessions({})), undefined)
})

test('pending phases skip the recent fallback (nothing settles before both baselines)', () => {
  const byId = { s1: session('s1', 100) }
  const state = workspaces([workspace('w-a', 'C:/project-a', ['s1'])], 'pending')
  assert.equal(resolveWorkspacePath(state, sessions(byId, 'pending')), undefined)
})
