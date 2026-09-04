import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

import type { CoggitService } from './service.js'
import {
  addProjection,
  renderJson,
  resolveProjection,
  statusProjection,
  toJsonValue,
} from './views.js'

/** Calling session's workspace (`SessionHeader.cwd`); non-agent callers fall back to the process cwd. */
function sessionWorkspace(exec: ToolExecution): string {
  return exec.agent?.session.header.cwd ?? '.'
}

/**
 * Resolve the self-provided `coggit` service via `ctx.get` (global store).
 * The `ctx.coggit` property proxy cannot reach it: the service registers on
 * this plugin's own child fiber, and the proxy walk is ancestor-only.
 */
function coggitService(ctx: Context): CoggitService {
  return ctx.get('coggit') as CoggitService
}

export function registerCoggitTools(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'coggit_status',
    description:
      'Get detailed diagnosis for one selected source file or folder. Defaults to the source root when no sourcePath is given: the root view diagnoses the whole project — the root\'s own status, every issue-bearing subtree node, and each one\'s next-step hints — as the entry point before focusing on a specific sourcePath. A hit returns the canonical compact status view: `ownIssueCount`/`descendantIssueCount`, log-style issue rows (`level`, `issueTags`, `actionTags`, `optionalActionTags`) split into `ownIssues`/`descendantIssues`, and `issueLegend`/`actionLegend` defining each tag once — descendant next steps appear in the descendant rows\' action tags, not in the top-level hints; a miss returns `found: false` with fuzzy `pathHints` candidates. A node with no paired cognition is not an issue — status reports `cognitionPresence: "missing"` with empty rows and a `create-cognition` add action, the materialization branch. Every result carries a `surfaceHints` array of next-step instructions (a tool call, a skill load, or a path retry); for a stale pair the handbook-sync skill hint leads the resolve call. Use it before explaining or editing a selected node, and again after editing paired cognition.',
    parameters: {
      sourcePath: {
        type: 'string',
        description: 'Source-root-relative path, e.g. src/main.ts or src/app. Defaults to root when not provided. Do not pass an absolute filesystem path.',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => renderJson(value),
    },
    async execute(args, exec) {
      const result = await coggitService(ctx).status(sessionWorkspace(exec), args.sourcePath ?? '.')
      const { view, surfaceHints: hints } = statusProjection(result)
      return toJsonValue({ ...view, surfaceHints: hints })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'coggit_add',
    description:
      'Create a missing CogGit cognition document for an existing source file or folder and register it for tracking. This writes files; keep overwrite false unless the user explicitly asks to regenerate existing cognition. This is the immediate write surface when the paired cognition is clearly missing. The created template is not a completed cognition document; on success the surfaceHints name the handbook skill to load with the skill tool before completing it.',
    parameters: {
      sourcePath: {
        type: 'string',
        required: true,
        description: 'Source-root-relative path to an existing source file or folder, e.g. src/main.ts or src/app. Do not pass an absolute filesystem path.',
      },
      kind: {
        type: 'string',
        enum: ['auto', 'leaf', 'skeleton'],
        description: 'auto chooses leaf for files and skeleton for folders. Use leaf only for files and skeleton only for folders. Defaults to auto.',
      },
      overwrite: {
        type: 'boolean',
        description: 'Replace existing cognition content when true. Defaults to false. Do not enable without explicit user approval.',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => renderJson(value),
    },
    async execute(args, exec) {
      const result = await coggitService(ctx).add(sessionWorkspace(exec), args.sourcePath, { kind: args.kind, overwrite: args.overwrite })
      const { view, surfaceHints: hints } = addProjection(result)
      return toJsonValue({ ...view, surfaceHints: hints })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'coggit_resolve',
    description:
      'Resolve a stale CogGit source/cognition state by accepting the current pair as reviewed. Call after inspecting the current source and paired cognition and confirming the cognition correctly covers the source. Re-records the accepted pair to the current contents. This is an explicit review declaration, not an automatic check.',
    parameters: {
      sourcePath: {
        type: 'string',
        required: true,
        description: 'Source-root-relative path for the stale source/cognition node to resolve. Do not pass an absolute filesystem path.',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => renderJson(value),
    },
    async execute(args, exec) {
      const result = await coggitService(ctx).resolve(sessionWorkspace(exec), args.sourcePath)
      const { view, surfaceHints: hints } = resolveProjection(result)
      return toJsonValue({ ...view, surfaceHints: hints })
    },
  }))
}