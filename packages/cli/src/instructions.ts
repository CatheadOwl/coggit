import { getCoggitSystemPrompt, type CoggitSystemPromptKind } from '@coggit/core';

import { UserFacingError } from './status';

export type InstructionsFormat = 'raw' | 'block';

/**
 * Print-side of the prompt-form channel for CLI agent hosts: emits a
 * surface-neutral form from `@coggit/core` as-is (the CLI-baseline addressing
 * is already terminal here). `raw` is for `$(...)` composition with host
 * flags; `block` wraps the content in managed markers carrying kind and
 * version so an update replaces the block inside an instruction file such as
 * `AGENTS.md` without touching surrounding text. The command is read-only —
 * persistent injection is the caller's redirect or paste.
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
  if (format === 'raw') {
    return prompt.content;
  }
  return [
    `<!-- coggit:begin system-prompt kind=${prompt.kind} version=${prompt.version} -->`,
    prompt.content,
    '<!-- coggit:end -->',
  ].join('\n');
}
