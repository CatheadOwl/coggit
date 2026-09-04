import type { JsonValue } from '@deepseek-ai/dsh-util-values'

import type {
  AddOperationResult,
  CognitionKind,
  CoggitOperationAction,
  CoreOperationId,
  ResolveOperationResult,
  StatusAgentPresentation,
  StatusOperationResult,
} from '@coggit/core'
import { projectStatusAgentPresentation, projectStatusMissPresentation } from '@coggit/core'

/** Cleanse plain-data projections for dsh's lossless-JSON boundary: `undefined` props omitted, `undefined` array items → null (see leaf). */
export function toJsonValue(value: unknown): JsonValue {
  return toLosslessJson(value)
}

/** Recursive lossless-JSON projection; see {@link toJsonValue}. */
function toLosslessJson(value: unknown): JsonValue {
  if (value === undefined) return null
  if (value === null || typeof value !== 'object') return value as JsonValue
  if (Array.isArray(value)) {
    return value.map(item => item === undefined ? null : toLosslessJson(item))
  }
  const record: Record<string, JsonValue> = {}
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) record[key] = toLosslessJson(item)
  }
  return record
}

/** Project a canonical JSON value to model-facing text (lossless JSON dump). */
export function renderJson(value: JsonValue): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

// ─── Status projection ────────────────────────────────────────────────────────

/** A MISS: only the lookup identity and (optional) fuzzy candidates. No status, no issues — those only exist once a node is found. */
export interface StatusMissView {
  found: false
  sourcePath: string
  /** Present only when non-empty (fuzzy source-path candidates). */
  pathHints?: string[]
}

/**
 * Model-facing `coggit_status` payload: the core HIT projection or the adapter's
 * MISS branch (`found: false`).
 *
 * The HIT view is core's canonical `StatusAgentPresentation` — the same
 * structured projection the upstream CLI and MCP text render
 * (`statusAgentPresentation.ts`): a compact log-style surface with stable
 * issue/action tags and legends, fully aligned with the upstream status
 * format. Rows carry `level`/`issueTags`/`actionTags`/`optionalActionTags`,
 * legend entries define each tag once, and counts split own vs descendant.
 * A node with no paired cognition is NOT an issue — it is the materialization
 * branch: `cognitionPresence: "missing"` with empty rows/legends, and the
 * create-cognition add action carried by `surfaceHints` (upstream ADR 0015).
 * The adapter only appends its `surfaceHints` addressing (tool calls / skill
 * loads); nothing here is re-derived from issue `code` or `status: null`.
 */
export type StatusResultView = StatusAgentPresentation | StatusMissView

/** Shared miss hint: candidate source-root-relative paths to try. */
function pathHintsHint(pathHints: string[]): string {
  return `Try one of these source-root-relative paths: ${pathHints.map(p => `"${p}"`).join(', ')}.`
}

/**
 * One-step status projection: `{ view, surfaceHints }`.
 *
 * - MISS: the core `projectStatusMissPresentation` view plus a fuzzy-candidate
 *   hint (a genuinely unknown path has no next step).
 * - HIT: the core `projectStatusAgentPresentation` view plus the
 *   surface-neutral mapping loop (`suggestedAction.operation` → tool,
 *   `handbookId` → skill).
 *
 * Core emits operation-bearing `add`/`resolve` actions from node signals (the
 * materialization branch for `cognitionPresence: 'missing'`, the ordered
 * sync+resolve pair for stale), so there is no branch on `status`, issue
 * `code`, or `cognitionPresence` here: the loop maps whatever core emitted.
 * Descendant actions stay in core's own-node-only top-level channel boundary:
 * top-level `surfaceHints` carries the current node's steps; descendant next
 * steps appear in `descendantIssues` rows as action tags (defined once in
 * `actionLegend`), matching the CLI/MCP text surface.
 *
 * The MISS branch is intentionally narrower than the HIT pass-through: it adds
 * this adapter's own `found: false` discriminator and re-renders hints from
 * `pathHints`, dropping core's miss/hint prose (prose is not a next-step signal
 * on this model face). Core's miss projection stays `found`-free so MCP can
 * spread it unchanged; this asymmetry is deliberate, not drift.
 */
export function statusProjection(result: StatusOperationResult): { view: StatusResultView; surfaceHints: string[] } {
  const inspection = result.inspection
  if (!inspection) {
    const miss = projectStatusMissPresentation(result)
    const view: StatusMissView = {
      found: false,
      sourcePath: miss.sourcePath,
      ...(miss.pathHints.length > 0 ? { pathHints: miss.pathHints } : {}),
    }
    const hints = miss.pathHints.length > 0 ? [pathHintsHint(miss.pathHints)] : []
    return { view, surfaceHints: hints }
  }

  return {
    view: projectStatusAgentPresentation(inspection),
    surfaceHints: surfaceHints(result),
  }
}
// ─── Add / resolve projections ───────────────────────────────────────────────

/** Shared error envelope: `code` + `message` are the machine-readable next-step signal. */
export interface OperationErrorView {
  code: string
  message: string
}

/** A failed add/resolve: the error is the signal; `pathHints` present only on a path miss with candidates. */
export interface OperationFailureView {
  success: false
  sourcePath: string
  error: OperationErrorView
  pathHints?: string[]
}

/** Add success: identity + whether it created or already existed (handbook/re-check live in surfaceHints). */
export interface AddSuccessView {
  success: true
  created: boolean
  kind: CognitionKind
  sourcePath: string
  cognitionPath: string
}

/** Model-facing `coggit_add` payload: success / failure, each branch carrying only its own fields. */
export type AddResultView = AddSuccessView | OperationFailureView

/** Resolve success: the accepted pair's identity. Registry key/timestamp are receipt data, not next-step signals. */
export interface ResolveSuccessView {
  success: true
  sourcePath: string
  cognitionPath: string | null
}

/** Model-facing `coggit_resolve` payload: success / failure, each branch carrying only its own fields. */
export type ResolveResultView = ResolveSuccessView | OperationFailureView

/**
 * Condense an add operation result: success keeps created/kind/cognitionPath;
 * failure keeps the error + optional pathHints. `project` URI context and the
 * null-fillers (`created:null`/`kind:null`/`cognitionPath:null` on failure) are
 * dropped — they only exist in the branch where they are meaningful.
 */
export function addView(result: AddOperationResult): AddResultView {
  if (result.success) {
    return {
      success: true,
      created: result.created!,
      kind: result.kind!,
      sourcePath: result.sourcePath,
      cognitionPath: result.cognitionPath!,
    }
  }
  return operationFailureView(result.sourcePath, result.error!, result.pathHints)
}

/** Condense a resolve operation result: success keeps the accepted pair's identity; failure keeps the error + optional pathHints. */
export function resolveView(result: ResolveOperationResult): ResolveResultView {
  if (result.success) {
    return {
      success: true,
      sourcePath: result.sourcePath,
      cognitionPath: result.cognitionPath,
    }
  }
  return operationFailureView(result.sourcePath, result.error!, result.pathHints)
}

function operationFailureView(
  sourcePath: string,
  error: { code: string; message: string },
  pathHints: string[],
): OperationFailureView {
  return {
    success: false,
    sourcePath,
    error: { code: error.code, message: error.message },
    ...(pathHints.length > 0 ? { pathHints } : {}),
  }
}

/**
 * Failure hints: a path miss offers candidates (re-running the same miss just
 * misses again); any other failure emits the re-check action so the model
 * re-inspects current state via `coggit_status`. Re-check is failure-only —
 * success branches are self-confirming and carry no re-check hint.
 */
function failureHints(view: OperationFailureView, result: SurfaceHintInput): string[] {
  if (view.error.code === 'path-not-found') {
    return view.pathHints && view.pathHints.length > 0 ? [pathHintsHint(view.pathHints)] : []
  }
  return surfaceHints(result)
}

/**
 * One-step add projection: success keeps the action/handbook hints (no re-check —
 * the returned cognitionPath already confirms the write); a path miss offers
 * candidates; any other failure emits the re-check action.
 */
export function addProjection(result: AddOperationResult): { view: AddResultView; surfaceHints: string[] } {
  const view = addView(result)
  if (!view.success) {
    return { view, surfaceHints: failureHints(view, result) }
  }
  return { view, surfaceHints: surfaceHints(result) }
}

/** One-step resolve projection; see {@link addProjection} for the branch logic. */
export function resolveProjection(result: ResolveOperationResult): { view: ResolveResultView; surfaceHints: string[] } {
  const view = resolveView(result)
  if (!view.success) {
    return { view, surfaceHints: failureHints(view, result) }
  }
  return { view, surfaceHints: surfaceHints(result) }
}

// ─── Skill / tool-name mapping ────────────────────────────────────────────────

/** Skill name this adapter registers for one handbook id. */
export function handbookSkillName(handbookId: 'leaf' | 'skeleton'): string {
  return `coggit-handbook-${handbookId}`
}

/** Adapter-owned mapping from core's surface-neutral operation id to this surface's tool name (see leaf). */
export function operationToolName(operation: CoreOperationId): string {
  return `coggit_${operation}`
}

/** Hint-bearing fields a core operation result may carry. */
export interface SurfaceHintInput {
  suggestedActions?: readonly CoggitOperationAction[]
  handbookId?: 'leaf' | 'skeleton' | null
}

function actionSurfaceHint(action: CoggitOperationAction): string | null {
  if (action.operation !== undefined) {
    const args: string[] = []
    if (action.scope !== undefined) args.push(`scope="${action.scope}"`)
    if (action.sourcePath !== undefined) args.push(`sourcePath="${action.sourcePath}"`)
    if (action.maxDepth !== undefined && action.maxDepth !== null) args.push(`maxDepth=${action.maxDepth}`)
    const suffix = args.length > 0 ? ` with ${args.join(', ')}` : ''
    return `Call ${operationToolName(action.operation)}${suffix}.`
  }
  if (action.handbookId !== undefined) {
    return `Before authoring or editing this cognition, load skill "${handbookSkillName(action.handbookId)}" with the skill tool.`
  }
  return null
}

/** Translate core's surface-neutral action/handbook hints into this surface's `coggit_*` tool / skill addressing. */
export function surfaceHints(result: SurfaceHintInput): string[] {
  const hints: string[] = []
  for (const action of result.suggestedActions ?? []) {
    const hint = actionSurfaceHint(action)
    if (hint !== null) hints.push(hint)
  }
  if (result.handbookId) {
    // Suppress the top-level handbook hint when a step-local action already
    // carries the same handbookId (mirrors MCP's hasStepLocalHandbookAction).
    const hasStepLocal = (result.suggestedActions ?? []).some(a => a.handbookId === result.handbookId)
    if (!hasStepLocal) {
      hints.push(`Before authoring or editing this cognition, load skill "${handbookSkillName(result.handbookId)}" with the skill tool.`)
    }
  }
  return hints
}
