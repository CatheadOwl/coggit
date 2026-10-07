import { getCoggitSystemPrompt, type CoggitSystemPromptKind } from '@coggit/core';

import { UserFacingError } from './status';

export type InstructionsFormat = 'raw' | 'block';

/**
 * The CLI host's access layer: the entry pointer this surface prepends to
 * the host-agnostic prompt forms. The core body references operations by
 * name and carries no surface spelling — an agent on a CLI host has no
 * injected functions, so the one thing guidance must add is the entry.
 * Mechanics stay out: `--help` self-describes the commands.
 */
export const CLI_ENTRY_SENTENCE =
  'CogGit is available as the `coggit` CLI — `coggit --help` lists the commands.';

/**
 * Print-side of the prompt-form channel for CLI agent hosts: entry sentence
 * + form, for both kinds (access is a host axis, orthogonal to kind — it
 * also gives minimal's "Use it" its referent). `raw` is for `$(...)`
 * composition with host flags; `block` wraps the composite in managed
 * markers carrying kind and version so an update replaces the block inside
 * an instruction file such as `AGENTS.md` without touching surrounding
 * text. The command is read-only — persistent injection is the caller's
 * redirect or paste.
 */
export function runInstructions(
  kind: CoggitSystemPromptKind,
  format: InstructionsFormat,
): string {
  // The kind union can outrun an older installed @coggit/core — resolve at
  // runtime and fail loud, mirroring the dsh systemPromptKind guard.
  const prompt = getCoggitSystemPrompt(kind);
  if (prompt === undefined) {
    throw new UserFacingError(`system prompt kind '${kind}' is not provided by the installed @coggit/core`);
  }
  const composite = [CLI_ENTRY_SENTENCE, prompt.content].join('\n');
  if (format === 'raw') {
    return composite;
  }
  return [
    `<!-- coggit:begin system-prompt kind=${prompt.kind} version=${prompt.version} -->`,
    composite,
    '<!-- coggit:end -->',
  ].join('\n');
}
