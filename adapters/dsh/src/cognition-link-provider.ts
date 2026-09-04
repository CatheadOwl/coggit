import type { Context } from '@deepseek-ai/cordis'
import { tryGetCognitionPath } from '@coggit/core'
import type { CoggitSnapshot, StatusOperationResult } from '@coggit/core'

import { hasCoggitConfig } from './service.js'
import type { CoggitService } from './service.js'

/**
 * Local structural mirror of prompt-middleware's frozen `RelatesResolveResult`
 * (see `workunits/prompt-middleware/spec/declarative-enricher-api.md`). The
 * provider is registered through the `ctx.inject(['promptMiddleware'], ...)`
 * soft dependency, so the plugin keeps no hard type/runtime import of
 * prompt-middleware (same registration shape as any_routes' breadcrumb).
 */
export interface RelatesResolveResult {
  value?: string
  href?: string
  meta?: Record<string, string>
}

/** Structural subset of the frozen `DeclarativeRelatesProvider` this provider implements. */
export interface CognitionLinkRelatesProvider {
  name: string
  kind: string
  priority: number
  resolve(ctx: {
    path: { path: string }
    input: { cwd: string; turnId: string }
  }): Promise<RelatesResolveResult | undefined>
}

const PROVIDER_NAME = 'cognition-link-enricher'
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
 * Declarative provider: builds one snapshot per turn (`input.turnId`), reuses
 * it across paths, then discards it when the turn changes (reconcile-on-read).
 */
export function createCognitionLinkProvider(coggit: CoggitService): CognitionLinkRelatesProvider {
  let cachedTurnId: string | undefined
  let snapshot: CoggitSnapshot | undefined
  return {
    name: PROVIDER_NAME,
    kind: PROVIDER_KIND,
    priority: PROVIDER_PRIORITY,
    resolve: async ({ path, input }) => {
      // Unconfigured workspace: no snapshot build (avoids a per-turn full scan)
      // and no relates item — miss / missing / not-applicable collapse here.
      if (!hasCoggitConfig(input.cwd)) return undefined
      if (cachedTurnId !== input.turnId) {
        snapshot = await coggit.buildSnapshot(input.cwd)
        cachedTurnId = input.turnId
      }
      const result = await coggit.statusWithSnapshot(input.cwd, path.path, snapshot!)
      return resolveCognitionLink(result)
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
