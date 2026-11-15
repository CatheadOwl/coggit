import {
  getCoggitSystemPrompt,
  STANDARD_SYSTEM_PROMPT_SEGMENTS,
  type CoggitSystemPromptKind,
  type StandardPromptSegmentKey,
} from '@coggit/core';

import { UserFacingError } from './status';

export type EntryFormat = 'raw' | 'block';

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
 * The orientation pointer: the entry sentence teaches entry, this sentence
 * answers the first orientation questions (where are the roots, where is
 * this file's pair) with the commands that actually answer on the CLI text
 * surface — status header and per-path status. Rides both kinds: the
 * standard composite keeps it, and the minimal invariant block needs it to
 * orient a pasting host. Supersedes owner ruling 2026-10-08 (orientation
 * rode the standard kind only; minimal kept entry-only density) — minimal
 * exchanges that density for the self-refreshing paste-once property
 * (ADR 0034).
 */
export const CLI_ORIENTATION_SENTENCE =
  'Orient with `coggit status`: the header names the source and cognition roots, and `coggit status <path>` names a file\'s paired cognition document.';

/**
 * The paste-once layer's self-refresh seam (ADR 0034): the minimal invariant
 * block carries invariant content only, so stance wording evolution reaches
 * agents through this pointer instead of a re-paste. Rides the minimal kind
 * only — the standard form IS the full stance this pointer names.
 */
export const CLI_FETCH_POINTER_SENTENCE =
  'Full stance: `coggit entry --kind standard` prints the complete, always-current guidance.';

/**
 * The CLI host's spellings for the `standard` form — the same per-host access
 * seam `@coggit/mcp` mounts at its `instructions` (it re-voices the delegation
 * segment to the `coggit://handbook/<kind>` resource): core's body references
 * "handbook guidance" with zero surface spellings, so the CLI names the
 * command that prints it. Every other segment passes through byte-equal to
 * core; `minimal` has no delegation segment, so the override is standard-only
 * by construction.
 */
const CLI_SEGMENT_OVERRIDES: Readonly<Partial<Record<StandardPromptSegmentKey, string>>> = {
  delegation:
    'CogGit cognition maintenance is source-scoped and suitable for subagents: delegate independent sourcePath updates along with the relevant `coggit handbook <kind>` guidance.',
};

/**
 * Print-side of the prompt-form channel for CLI agent hosts: access
 * sentences + form (access is a host axis, orthogonal to kind — the entry
 * sentence gives minimal's "Use it" its referent; the orientation sentence
 * rides both kinds, and the fetch pointer rides the paste-once minimal
 * block only). `raw` is for `$(...)` composition with
 * host flags; `block` wraps the composite in managed markers carrying kind
 * and version so an update replaces the block inside an instruction file
 * such as `AGENTS.md` without touching surrounding text — the first line
 * inside the markers is the guardrail notice that teaches this replace
 * move (`blockManagementNotice`). The command is read-only — persistent
 * injection is the caller's redirect or paste.
 */
export function runEntry(
  kind: CoggitSystemPromptKind,
  format: EntryFormat,
): string {
  // The kind union can outrun an older installed @coggit/core — resolve at
  // runtime and fail loud, mirroring the dsh systemPromptKind guard.
  const prompt = getCoggitSystemPrompt(kind);
  if (prompt === undefined) {
    throw new UserFacingError(`system prompt kind '${kind}' is not provided by the installed @coggit/core`);
  }
  const accessLines =
    kind === 'standard'
      ? [CLI_ENTRY_SENTENCE, CLI_ORIENTATION_SENTENCE]
      : [CLI_ENTRY_SENTENCE, CLI_ORIENTATION_SENTENCE, CLI_FETCH_POINTER_SENTENCE];
  // The standard body is re-derived from the segments so the CLI overrides
  // apply (the joined form is byte-equal to core's content for untouched
  // segments); minimal is a single content blob with no segments to re-voice.
  const body =
    kind === 'standard'
      ? STANDARD_SYSTEM_PROMPT_SEGMENTS.map(
          (segment) => CLI_SEGMENT_OVERRIDES[segment.key] ?? segment.text,
        ).join('\n')
      : prompt.content;
  const composite = [...accessLines, body].join('\n');
  if (format === 'raw') {
    return composite;
  }
  return [
    `<!-- coggit:begin system-prompt kind=${prompt.kind} version=${prompt.version} -->`,
    blockManagementNotice(prompt.kind),
    composite,
    '<!-- coggit:end -->',
  ].join('\n');
}

/**
 * First line inside the managed block: the paste/replace guardrail, taught
 * at the point of paste. Without it the marker idiom's update move (replace
 * the whole block, markers included) lives only in owner docs — an agent
 * re-installing by append (`>>`) stacks a duplicate block. The notice names
 * the exact re-run command for the block's own kind, so the pointer answers
 * the update question in one step.
 */
function blockManagementNotice(kind: CoggitSystemPromptKind): string {
  return `CogGit guidance block — generated by \`coggit entry\`; do not hand-edit. To update, re-run \`coggit entry --kind ${kind} --format block\` and replace this whole block (markers included).`;
}
