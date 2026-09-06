import type { Context } from '@deepseek-ai/cordis'
import { projectRelativePair, tryGetCognitionPath } from '@coggit/core'
import type { CoggitSnapshot, CoggitWorkspaceRoot, StatusOperationResult } from '@coggit/core'

import { hasCoggitConfig } from './service.js'
import type { CoggitService } from './service.js'

/**
 * Local structural mirror of prompt-middleware's frozen `RelatesResolveResult`
 * (the spec lives with the prompt-middleware project). The
 * provider is registered through the `ctx.inject(['promptMiddleware'], ...)`
 * soft dependency, so the plugin keeps no hard type/runtime import of
 * prompt-middleware (same registration shape as any_routes' breadcrumb).
 */
export interface RelatesResolveResult {
  value?: string
  href?: string
  meta?: Record<string, string>
}

/**
 * Structural subset of the frozen `ResolvedPromptPath` this provider reads.
 * `origin` is `'prompt-parse'` for prompt mentions and `'touch'` for tool-touch
 * pseudo-paths; `touchTool` is set only for touches (`'read' | 'edit'` by
 * convention — open string upstream).
 */
export interface ResolvedPromptPathLike {
  path: string
  kind?: 'file' | 'directory'
  origin?: string
  touchTool?: string
}

/** Structural subset of the frozen `DeclarativeRelatesProvider` this provider implements. */
export interface CognitionLinkRelatesProvider {
  name: string
  description: string
  kind: string
  priority: number
  /** Signal sources consumed; `['prompt', 'touch']` subscribes to the tool-touch sensor lane. */
  sources?: Array<'prompt' | 'touch'>
  /**
   * Reverse touch projection onto this provider's subjects (the paired source
   * path, project-relative). Pure path computation via the SDK's pairing
   * convention (`projectRelativePair`) — no FS access.
   */
  touchSubjects?(touchedPath: string): string[]
  resolve(ctx: {
    path: ResolvedPromptPathLike
    input: { cwd: string; turnId: string }
  }): Promise<RelatesResolveResult | undefined>
}

/** What was last rendered for one subject: the append-only history anchor of the rendering policy. */
interface RenderedPairState {
  cognitionPath: string
  stale: boolean
}

const PROVIDER_NAME = 'cognition-link-enricher'
const PROVIDER_DESCRIPTION = 'Links each mentioned path to its paired CogGit cognition document, marked stale or fresh (CogGit cognition-link).'
const PROVIDER_KIND = 'cognition-link'
// canonical band (0–99), ahead of breadcrumb-description's annotation band (100–199).
const PROVIDER_PRIORITY = 10

/**
 * Pure projection: a `cognition-link` item for a status hit, `undefined` for
 * source miss / missing cognition / not-applicable (those collapse to `null`
 * in `tryGetCognitionPath`). `stale` is carried as a meta marker only.
 */
export function resolveCognitionLink(result: StatusOperationResult): RelatesResolveResult | undefined {
  const hit = tryGetCognitionPath(result)
  if (hit === null) return undefined
  return { href: hit.cognitionPath, meta: { stale: String(hit.stale) } }
}

/**
 * Declarative provider with the touch lane (prompt-middleware W11). The
 * rendering policy lives entirely here — the framework only does pending,
 * invalidation, and re-run:
 *
 * - steady state: same `{ cognitionPath, stale }` as the last render returns
 *   `undefined` (one snapshot query per touch, zero injection);
 * - the agent's own edit reconciles the record silently (`origin: 'touch'` +
 *   `touchTool: 'edit'` — narrating the agent's own action is noise);
 * - a state flip after a previous render re-emits the link with an
 *   `updated: 'true'` meta marker: injections are append-only history, the
 *   one cheap line is the only invalidation notice.
 *
 * One snapshot (and roots cache) per turn (`input.turnId`), reused across
 * paths, discarded when the turn changes (reconcile-on-read). Design record:
 * `docs/touch-lane.md`.
 */
export function createCognitionLinkProvider(coggit: CoggitService): CognitionLinkRelatesProvider {
  let cachedTurnId: string | undefined
  let snapshot: CoggitSnapshot | undefined
  // Roots for the touch projection, refreshed per turn from the calling
  // session's cwd: the framework's record-time `touchSubjects` callback
  // carries no session context, so the union of seen roots is projected
  // against (cold-start touches degrade to a missed invalidation, never a
  // wrong injection — see docs/touch-lane.md).
  let cachedRoots: CoggitWorkspaceRoot[] = []
  const lastRendered = new Map<string, RenderedPairState>()
  return {
    name: PROVIDER_NAME,
    description: PROVIDER_DESCRIPTION,
    kind: PROVIDER_KIND,
    priority: PROVIDER_PRIORITY,
    sources: ['prompt', 'touch'],
    touchSubjects: (touchedPath) => {
      const subjects = new Set<string>()
      for (const root of cachedRoots) {
        const pair = projectRelativePair(root, touchedPath)
        if (pair !== undefined) subjects.add(pair.sourcePath)
      }
      return [...subjects]
    },
    resolve: async ({ path, input }) => {
      // Unconfigured workspace: no snapshot build (avoids a per-turn full scan)
      // and no relates item — miss / missing / not-applicable collapse here.
      if (!hasCoggitConfig(input.cwd)) return undefined
      if (cachedTurnId !== input.turnId) {
        snapshot = await coggit.buildSnapshot(input.cwd)
        cachedRoots = await coggit.roots(input.cwd)
        cachedTurnId = input.turnId
      }
      const result = await coggit.statusWithSnapshot(input.cwd, path.path, snapshot!)
      const link = resolveCognitionLink(result)
      if (link?.href === undefined) {
        lastRendered.delete(path.path)
        return undefined
      }
      const current: RenderedPairState = {
        cognitionPath: link.href,
        stale: link.meta?.stale === 'true',
      }
      // The agent's own edit: reconcile the record, never narrate it back.
      if (path.origin === 'touch' && path.touchTool === 'edit') {
        lastRendered.set(path.path, current)
        return undefined
      }
      const previous = lastRendered.get(path.path)
      lastRendered.set(path.path, current)
      if (previous === undefined) return link
      if (previous.cognitionPath === current.cognitionPath && previous.stale === current.stale) {
        return undefined
      }
      return { ...link, meta: { ...link.meta, updated: 'true' } }
    },
  }
}

/**
 * Soft-dependency registration: only when prompt-middleware is present, call
 * `registerRelates` (the declarative face) with a fresh provider bound to the
 * self-provided `coggit` service.
 */
export function registerCognitionLinkProvider(ctx: Context): void {
  const coggit = ctx.get('coggit') as CoggitService
  void ctx.inject(['promptMiddleware'], (promptCtx) => {
    return (promptCtx as unknown as {
      promptMiddleware: {
        registerRelates(provider: CognitionLinkRelatesProvider): unknown
      }
    }).promptMiddleware.registerRelates(createCognitionLinkProvider(coggit))
  })
}
