import type { Context } from '@deepseek-ai/cordis'
import { projectRelativePair, tryGetCognitionPath } from '@coggit/core'
import type { CoggitSnapshot, CoggitWorkspaceRoot, StatusOperationResult } from '@coggit/core'

import { hasCoggitConfig } from './service.js'
import type { CoggitService } from './service.js'

/**
 * Local structural mirror of enrichment's frozen `RelatesResolveResult`
 * (the spec lives with the enrichment project). The
 * provider is registered through the `ctx.inject(['enrichment'], ...)`
 * soft dependency, so the plugin keeps no hard type/runtime import of
 * enrichment (same registration shape as any_routes' breadcrumb).
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

/**
 * Structural subset of the frozen `TouchSubjectContext` the framework hands to
 * `touchSubjects`: the session cwd the sensor normalized the path against
 * (record time) or the current step's cwd (pre-step consumption), plus the
 * touch-owning session when the caller has one.
 */
export interface TouchSubjectContextLike {
  cwd: string
  sessionId?: string
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
   * convention (`projectRelativePair`) against the roots of `context.cwd` —
   * no FS access.
   */
  touchSubjects?(touchedPath: string, context: TouchSubjectContextLike): string[]
  resolve(ctx: {
    path: ResolvedPromptPathLike
    input: { cwd: string; turnId: string; session?: { id: string } }
  }): Promise<RelatesResolveResult | undefined>
}

/** What was last rendered for one subject: the append-only history anchor of the rendering policy. */
interface RenderedPairState {
  cognitionPath: string
  stale: boolean
}

/**
 * Per-session provider state. The framework's once ledger is keyed
 * `(sessionId, provider, subject)`; this is the provider-side counterpart —
 * steady-state silence is each session's own history, never the process's
 * (issue 20260913 finding B). `cachedTurn` rides the same scope because
 * `input.turnId` is a bare turn number: keying the snapshot by turnId alone
 * crosses sessions, and the snapshot is also cwd-bound, so the cache key is
 * `(turnId, cwd)` inside the session.
 */
interface SessionState {
  lastRendered: Map<string, RenderedPairState>
  cachedTurn?: { turnId: string; cwd: string; snapshot: CoggitSnapshot }
}

/** Fallback scope when the framework hands no session object: today's process-level behavior. */
const ANONYMOUS_SESSION = 'session:anonymous'

const PROVIDER_NAME = 'cognition-link-enricher'
const PROVIDER_DESCRIPTION = 'Links each mentioned path to its paired CogGit cognition document, marked stale or fresh (CogGit cognition-link).'
const PROVIDER_KIND = 'cognition-link'
// canonical band (0–99), ahead of breadcrumb-description's annotation band (100–199).
const PROVIDER_PRIORITY = 10

/**
 * Pure projection: a `cognition-link` item for a status hit, `undefined` for
 * source miss / missing cognition / not-applicable (those collapse to `null`
 * in `tryGetCognitionPath`). `meta` is the model-visible annotation channel:
 * keys are written only when they carry information (steady-state silence is
 * the provider's job, not the renderer's), so `stale` is set only when stale.
 */
export function resolveCognitionLink(result: StatusOperationResult): RelatesResolveResult | undefined {
  const hit = tryGetCognitionPath(result)
  if (hit === null) return undefined
  return hit.stale ? { href: hit.cognitionPath, meta: { stale: 'true' } } : { href: hit.cognitionPath }
}

function renderThrown(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Declarative provider with the touch lane (enrichment W11). The
 * rendering policy lives entirely here — the framework only does pending,
 * invalidation, and re-run:
 *
 * - steady state: same `{ cognitionPath, stale }` as the last render returns
 *   `undefined` (one snapshot query per touch, zero injection) — scoped
 *   per session, like the framework's once ledger;
 * - the agent's own edit reconciles the record silently (`origin: 'touch'` +
 *   `touchTool: 'edit'` — narrating the agent's own action is noise);
 * - a state flip after a previous render re-emits the link with an
 *   `updated: 'true'` meta marker: injections are append-only history, the
 *   one cheap line is the only invalidation notice.
 *
 * One snapshot per `(session, cwd, turn)` — `input.turnId` is a bare turn
 * number, so the turn cache is scoped inside the session state and rebuilt
 * when either turnId or cwd changes (reconcile-on-read). Failure boundaries
 * (issue 20260913 findings A/C): each path's status call is isolated (one
 * bad path yields `undefined`, never a thrown batch); the roots warm runs
 * before and independent of the snapshot build, so a failing first batch
 * cannot freeze the touch lane; every swallowed failure warns through
 * `logger` — the framework's non-ok traces only reach debug. Design record:
 * `docs/touch-lane.md`.
 */
export function createCognitionLinkProvider(coggit: CoggitService, logger?: Context['logger']): CognitionLinkRelatesProvider {
  const warn = (message: string) => { logger?.warn(`cognition-link: ${message}`) }
  const sessions = new Map<string, SessionState>()
  // Roots per workspace root, warmed by `resolve` (which sees `input.cwd` per
  // turn) and consulted by `touchSubjects` through its explicit
  // `TouchSubjectContext.cwd`. Warming is failure-isolated and ordered before
  // the snapshot build, so a snapshot failure never starves the touch
  // projection; an unwarmed cwd still returns no subjects this call and is
  // warmed in the background for the next one — the residual cold-start is a
  // missed invalidation for the first touches of a brand-new cwd, never a
  // wrong injection (see docs/touch-lane.md).
  const rootsByCwd = new Map<string, CoggitWorkspaceRoot[]>()
  const warmRoots = async (cwd: string): Promise<void> => {
    if (rootsByCwd.has(cwd)) return
    try {
      rootsByCwd.set(cwd, await coggit.roots(cwd))
    } catch (error) {
      warn(`roots warm failed for ${cwd}: ${renderThrown(error)} (the touch projection retries on the next miss)`)
    }
  }
  const sessionState = (session: { id: string } | undefined): SessionState => {
    const key = session?.id ?? ANONYMOUS_SESSION
    let state = sessions.get(key)
    if (state === undefined) {
      state = { lastRendered: new Map() }
      sessions.set(key, state)
    }
    return state
  }
  return {
    name: PROVIDER_NAME,
    description: PROVIDER_DESCRIPTION,
    kind: PROVIDER_KIND,
    priority: PROVIDER_PRIORITY,
    sources: ['prompt', 'touch'],
    touchSubjects: (touchedPath, context) => {
      const roots = rootsByCwd.get(context.cwd)
      if (roots === undefined) {
        // Unknown cwd: no subjects this call; warm it in the background so
        // the next touch of this cwd projects exactly.
        if (hasCoggitConfig(context.cwd)) {
          coggit.roots(context.cwd).then(
            (warmed) => rootsByCwd.set(context.cwd, warmed),
            (error) => warn(`background roots warm failed for ${context.cwd}: ${renderThrown(error)}`),
          )
        }
        return []
      }
      const subjects = new Set<string>()
      for (const root of roots) {
        const pair = projectRelativePair(root, touchedPath)
        if (pair !== undefined) subjects.add(pair.sourcePath)
      }
      return [...subjects]
    },
    resolve: async ({ path, input }) => {
      // Unconfigured workspace: no snapshot build (avoids a per-turn full scan)
      // and no relates item — miss / missing / not-applicable collapse here.
      if (!hasCoggitConfig(input.cwd)) return undefined
      // Roots first, failure-isolated: the touch lane must survive a failing
      // snapshot build (issue 20260913 finding C).
      await warmRoots(input.cwd)
      const state = sessionState(input.session)
      let turn = state.cachedTurn
      if (turn === undefined || turn.turnId !== input.turnId || turn.cwd !== input.cwd) {
        // A snapshot build failure stays loud (the framework records the
        // failed batch for this step); the warn keeps it observable outside
        // debug-level traces, and the roots above are already warm.
        try {
          turn = { turnId: input.turnId, cwd: input.cwd, snapshot: await coggit.buildSnapshot(input.cwd) }
        } catch (error) {
          warn(`snapshot build failed for ${input.cwd}: ${renderThrown(error)}`)
          throw error
        }
        state.cachedTurn = turn
      }
      let result: StatusOperationResult
      try {
        result = await coggit.statusWithSnapshot(input.cwd, path.path, turn.snapshot)
      } catch (error) {
        // Per-path isolation is the provider's job (the framework's v0
        // contract does no per-path exception containment): one bad path
        // yields `undefined` for itself, never a voided batch.
        warn(`status failed for ${path.path}: ${renderThrown(error)}`)
        return undefined
      }
      const link = resolveCognitionLink(result)
      if (link?.href === undefined) {
        state.lastRendered.delete(path.path)
        return undefined
      }
      // Staleness comes from the status hit itself, not from `link.meta` (the
      // annotation channel is silent when fresh — see resolveCognitionLink).
      const stale = tryGetCognitionPath(result)?.stale === true
      const current: RenderedPairState = {
        cognitionPath: link.href,
        stale,
      }
      // The agent's own edit: reconcile the record, never narrate it back.
      if (path.origin === 'touch' && path.touchTool === 'edit') {
        state.lastRendered.set(path.path, current)
        return undefined
      }
      const previous = state.lastRendered.get(path.path)
      state.lastRendered.set(path.path, current)
      if (previous === undefined) return link
      if (previous.cognitionPath === current.cognitionPath && previous.stale === current.stale) {
        return undefined
      }
      return { ...link, meta: { ...link.meta, updated: 'true' } }
    },
  }
}

/**
 * Soft-dependency registration: only when enrichment is present, call
 * `registerRelates` (the declarative face) with a fresh provider bound to the
 * self-provided `coggit` service and the host logger (the provider's
 * failure-observability channel).
 */
export function registerCognitionLinkProvider(ctx: Context): void {
  const coggit = ctx.get('coggit') as CoggitService
  void ctx.inject(['enrichment'], (enrichmentCtx) => {
    return (enrichmentCtx as unknown as {
      enrichment: {
        registerRelates(provider: CognitionLinkRelatesProvider): unknown
      }
    }).enrichment.registerRelates(createCognitionLinkProvider(coggit, ctx.logger))
  })
}
