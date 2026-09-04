/**
 * Workspace-target resolution for the CogGit init tab.
 *
 * The tab addresses one workspace at a time. Resolution follows the same
 * data-access ladder the ui-workspace navigation policy uses
 * (UiWorkspaceService.startSession): the workspace owning the currently
 * selected session first, then the most recently active workspace, then
 * undefined — the browser wire omits the workspace and the server resolves
 * its own cwd. The harness no longer carries a UI-domain `recentWorkspaceId`
 * field on the Workspace snapshot (removed with the Runtime package), so the
 * recent fallback re-derives it from the two framework snapshots instead.
 */

import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'

/**
 * Resolve the workspace path the init tab should address.
 * @param workspaces - the global Workspace snapshot (useWorkspaces).
 * @param sessions - the global Session list snapshot (useSessions).
 * @returns the owning workspace path of the selected session, else the most
 * recently active workspace path, else undefined (server-cwd fallback).
 */
export function resolveWorkspacePath(
  workspaces: WorkspaceSnapshot,
  sessions: SessionListState,
): string | undefined {
  const current = sessions.current
  const owned = current === undefined
    ? undefined
    : workspaces.items.find(item => item.sessionIds.includes(current))
  if (owned !== undefined) return owned.path
  // The recent fallback mirrors ui-workspace's recentWorkspace(): only once
  // both lists settle, latest session updatedAt per workspace, host order
  // tie-break, createdAt when a workspace has no sessions.
  if (workspaces.phase !== 'ready' || sessions.phase !== 'ready') return undefined
  return mostRecentlyActive(workspaces.items, sessions.byId)?.path
}

function mostRecentlyActive(
  items: readonly WorkspaceView[],
  byId: SessionListState['byId'],
): WorkspaceView | undefined {
  let selected: WorkspaceView | undefined
  let selectedTime = Number.NEGATIVE_INFINITY
  for (const workspace of items) {
    let latest = Number.NEGATIVE_INFINITY
    for (const sessionId of workspace.sessionIds) {
      const session = byId[sessionId]
      if (session !== undefined) latest = Math.max(latest, session.updatedAt)
    }
    if (latest === Number.NEGATIVE_INFINITY) latest = Date.parse(workspace.createdAt)
    if (selected === undefined || latest > selectedTime) {
      selected = workspace
      selectedTime = latest
    }
  }
  return selected
}
