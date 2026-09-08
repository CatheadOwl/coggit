import type { JsonValue } from '@deepseek-ai/dsh-util-values'

import type {
  AddOperationResult,
  CognitionKind,
  CoggitOperationAction,
  CoreOperationId,
  ResolveOperationResult,
  StatusOperationResult,
} from '@coggit/core'
import { renderPathMissText, renderStatusAgentInspectionText } from '@coggit/core'

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

/** Project a canonical text value to model-facing text (delivered verbatim). */
export function renderText(value: string): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text: value }]
}

// ─── Status projection ────────────────────────────────────────────────────────

/** Shared miss hint: candidate source-root-relative paths to try. */
function pathHintsHint(pathHints: string[]): string {
  return `Try one of these source-root-relative paths: ${pathHints.map(p => `"${p}"`).join(', ')}.`
}

/**
 * One-step status projection as core's canonical agent-facing text.
 *
 * - MISS: core's `renderPathMissText` (not-found line plus fuzzy candidates)
 *   — the same miss text the MCP surface renders.
 * - HIT: core's `renderStatusAgentInspectionText` (legend-once + one-line
 *   rows + `actions=`/`optional=` channels, the status-surface role-contract
 *   decision shape)
 *   followed, after a blank line, by this adapter's `surfaceHints` lines.
 *
 * Text, not JSON, is the deliberate paradigm (FR 20260907-dsh-status-view-
 * core-text-rendering): the tool face serves the model only — one text line
 * per issue row vs ~8 JSON fields; CLI / MCP text / dsh all deliver the same
 * core renderer, and structural assertions live on core's
 * `StatusAgentPresentation` (tested there). Future non-model consumers
 * (e.g. a GUI status panel) take structured data from the core SDK, not from
 * this face. Hit/miss is discriminated by content (`Path not found…` lead vs
 * `Status:`/`Source:` header), not by JSON shape. (Branch key: core's
 * invariant that `inspection` is present iff the path was found; MCP's
 * `statusText` branches on `!found || !inspection` under the same invariant.)
 *
 * Hints are `statusActionHints(result)` — the action channel only (never the
 * top-level `handbookId` emission; the role-contract filter as documented
 * there).
 */
export function statusText(result: StatusOperationResult): string {
  const inspection = result.inspection
  if (!inspection || !result.found) {
    return renderPathMissText(result)
  }

  const body = renderStatusAgentInspectionText(inspection)
  const hints = statusActionHints(result)
  return hints.length > 0 ? `${body}\n\n${hints.join('\n')}` : body
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
  // Status-surface role contract (issue 20260906-1916): optional-on-demand
  // actions (`add`
  // materialization) must not be promoted into imperative hints — the
  // `cognitionPresence: "missing"` fact is the on-demand affordance.
  if (action.role === 'optional-on-demand') {
    return null
  }
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

/**
 * Status-face hints: action channel only, never the top-level `handbookId`
 * emission (issue 20260906-1916). Handbook addressing on the status face is
 * legitimate only from a step-local sync action (the stale pair); the
 * top-level emission was a premature third copy on fresh/missing nodes —
 * authoring actually starts at the `coggit_add` success result, which keeps
 * its `surfaceHints` handbook line (one-time session precondition per the
 * handbook-emission rule,
 * not a repeated next hint).
 */
function statusActionHints(result: SurfaceHintInput): string[] {
  const hints: string[] = []
  for (const action of result.suggestedActions ?? []) {
    const hint = actionSurfaceHint(action)
    if (hint !== null) hints.push(hint)
  }
  return hints
}
