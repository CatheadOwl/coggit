/**
 * Surface-neutral system prompt assets for CogGit hosts.
 *
 * A "system prompt" is the short guidance a host injects so an agent knows
 * CogGit exists and how to approach it. Forms range from a short hint
 * (minimal) to fuller operational instructions. Every form is surface-neutral:
 * it names CogGit as the project, references CLI-baseline commands only, and
 * never hard-codes a specific surface's tool names, resource URIs, or
 * addressing (`coggit_*`, `coggit://`). Hosts that need surface-specific
 * wording re-address these forms themselves (see the TODO below).
 */

export type CoggitSystemPromptKind = 'minimal';

export interface CoggitSystemPrompt {
  kind: CoggitSystemPromptKind;
  version: 'system-prompt-v1';
  content: string;
}

/**
 * The minimal form: the essential identity of CogGit — the mirrored cognition
 * layer and what it records — plus the keep-it-current directive, without
 * prescribing a workflow.
 */
export const MINIMAL_SYSTEM_PROMPT: CoggitSystemPrompt = {
  kind: 'minimal',
  version: 'system-prompt-v1',
  content:
    'CogGit mirrors the source tree with a cognition layer: each source file or folder has a paired design note at the same source-relative path — a file is mirrored by `<source path>.md`, a folder by its `README.md` — recording design intent, contracts, boundaries, and invariants rather than implementation summaries. Use it to explore the codebase, and when changing code, keep the paired cognition up to date.',
};

const SYSTEM_PROMPTS: Record<CoggitSystemPromptKind, CoggitSystemPrompt> = {
  minimal: MINIMAL_SYSTEM_PROMPT,
};

export function getCoggitSystemPrompt(
  kind: CoggitSystemPromptKind = 'minimal',
): CoggitSystemPrompt {
  return SYSTEM_PROMPTS[kind];
}

// TODO(system-prompt): add the fuller forms and let hosts re-address them.
// Planned (design discussion):
//   - `standard`: the operational guidance currently hard-coded as
//     `MCP_SERVER_INSTRUCTIONS` in `@coggit/mcp` (read cognition root first,
//     run `coggit routes` before reading source, delegate source-scoped
//     updates to subagents, report contradictions, verify with `coggit status`),
//     rewritten surface-neutral with CLI-baseline names (`coggit status`,
//     `coggit routes`, `coggit add`, `coggit resolve`, `coggit snapshot`,
//     `coggit handbook <kind>`) and no `coggit://` URIs.
//   - Host re-addressing: `@coggit/mcp` should derive its server `instructions`
//     from the `standard` form via the existing `MCP_TOOL_NAMES` /
//     `handbookUri` mapping instead of owning the text; the CLI may expose the
//     forms through an `instructions` command or handbook entry.
//   Full spec, draft text, and neutral→MCP re-addressing mapping:
//   TODO/FR/20260824-surface-neutral-standard-system-prompt.md.
