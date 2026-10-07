import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the `ctx.skills` Context augmentation; the registry
// service itself is provided by the host profile. No runtime import.
import type {} from '@deepseek-ai/dsh-skill'
import { getCognitionHandbook, getCoggitSystemPrompt, handbookCatalog } from '@coggit/core'
import type { CoggitSystemPromptKind } from '@coggit/core'

import {
  CoggitService,
  ConfigSchema,
  hasCoggitConfig,
} from './service.js'
import type { Config as CoggitConfig } from './service.js'
import { CoggitInitService } from './init-service.js'
import { registerCoggitTools } from './tools.js'
import { registerCoggitGates } from './gates.js'
import { registerCognitionLinkProvider } from './cognition-link-provider.js'
import { handbookSkillName } from './views.js'

export { CoggitService } from './service.js'
export { CoggitInitService } from './init-service.js'
export type { Config as CoggitConfig } from './service.js'

export const name = 'coggit'

export const inject = ['tools', 'skills', 'systemPrompt']

/**
 * The dsh-side standing directive binding the `[cognition-link]` lines (and
 * their `(stale)` / `(updated)` markers) to a default action with an allowed,
 * accounted deviation. Rendered by the `coggit:cognition-link` section when
 * `cognitionLinkDirective` is on; the token-stitching contract for this text
 * is enforced by `test/surface-contract.test.mjs`.
 */
export const COGNITION_LINK_DIRECTIVE = [
  'When a [cognition-link] line names a path you are about to read or edit, read the linked cognition document before acting on that source file; if you skip it, say why in one line.',
  '(stale) marks a cognition document that is out of date with its source — treat the source as current.',
  '(updated) marks a pair whose state changed since the link was last shown — read the cognition document again before relying on an earlier impression.',
].join(' ')

export const Config = ConfigSchema

/** Register node-kind handbooks as runtime skills — the dsh analog of MCP `coggit://handbook/<kind>`; the aggregate `all` stays out (see leaf). */
function registerHandbookSkills(ctx: Context): void {
  for (const entry of handbookCatalog()) {
    if (entry.kind === 'all') continue
    ctx.skills.register({
      name: handbookSkillName(entry.kind),
      description: entry.title,
      source: 'custom',
      content: getCognitionHandbook(entry.kind).content,
      // Model-only: the tool pipeline loads these on demand via the `skill`
      // tool when a coggit_* surfaceHints names them; a user `/name` gesture
      // must not inject a handbook body.
      invocation: { modelInvocable: true, userInvocable: false },
    })
  }
}

export async function apply(ctx: Context, config: CoggitConfig): Promise<void> {
  // No startup discovery gate: the workspace follows each caller (session cwd /
  // browser current workspace), so every face still registers unconditionally.
  // Model visibility is gated lazily below instead (per-assemble, per-session),
  // not at registration.
  await ctx.plugin(CoggitInitService)
  await ctx.plugin(CoggitService, config)
  registerHandbookSkills(ctx)
  registerCoggitTools(ctx)
  registerCoggitGates(ctx)
  registerCognitionLinkProvider(ctx)
  // Top-level mental model → a system-prompt section. Conditional injection:
  // the overview only renders when the calling session's workspace is a
  // configured CogGit project (`.coggit/config.yaml` present); otherwise the
  // text is empty and `renderPrompt` drops the section. Lazy text re-evaluates
  // per assemble, so the check sees each session's own workspace. Tool guidance
  // band (order 100–199); 117 is a free slot (`tool:read` already owns 100, so
  // reusing it would tie-break by registration order and lose cross-boot
  // determinism).
  ctx.systemPrompt.section({
    name: 'coggit:overview',
    order: 117,
    text: (context) => {
      if (!hasCoggitConfig(context.agent?.session.header.cwd ?? process.cwd())) return ''
      // The config domain forward-declares FR 20260824's `standard` form, so
      // the value can outrun the installed core's union — resolve at runtime
      // and fail loud. A silent `minimal` fallback would fake the eval arm
      // (same failure class the enrichment `persona` field died of).
      const prompt = getCoggitSystemPrompt(config.systemPromptKind as CoggitSystemPromptKind)
      if (prompt === undefined) {
        throw new Error(`coggit: systemPromptKind '${String(config.systemPromptKind)}' is not provided by the installed @coggit/core`)
      }
      return prompt.content
    },
  })

  // The injection-vocabulary directive (see COGNITION_LINK_DIRECTIVE). Same
  // lazy workspace gating and the same band, one slot behind the overview.
  ctx.systemPrompt.section({
    name: 'coggit:cognition-link',
    order: 118,
    text: (context) => hasCoggitConfig(context.agent?.session.header.cwd ?? process.cwd()) && config.cognitionLinkDirective === true
      ? COGNITION_LINK_DIRECTIVE
      : '',
  })

  // Hide the `coggit_*` tool schemas when the workspace is not configured. The
  // execution face stays active — the tools are total functions (an
  // unconfigured workspace reports `found: false`), so this only controls model
  // visibility and no execution guard is needed.
  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const result = await next()
    if (!hasCoggitConfig(context.agent?.session.header.cwd ?? process.cwd())) {
      result.tools = result.tools.filter(tool => !tool.name.startsWith('coggit_'))
    }
    return result
  })
}
