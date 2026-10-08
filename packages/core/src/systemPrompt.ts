/**
 * Host-agnostic system prompt assets for CogGit hosts.
 *
 * A "system prompt" is the short guidance a host injects so an agent knows
 * CogGit exists and how to approach it. Forms range from a short hint
 * (minimal) to fuller operational instructions (standard). Every form is a
 * universal body: it names CogGit as the project and references operations
 * by name ("the snapshot operation", "the status operation", "handbook
 * guidance") with zero surface spellings — no CLI command spellings, no
 * `coggit_*` tool names, no `coggit://` URIs. Where the CogGit affordance
 * lives is a host property, and each host adds its own thin access layer:
 *
 * - dsh passes a form through its `ctx.systemPrompt` sections unchanged —
 *   the injected `coggit_*` functions self-describe, so no entry is needed;
 * - `@coggit/mcp` supplies the MCP spellings (tool names, resource URIs) at
 *   its `instructions` seam;
 * - `@coggit/cli` prepends its own access sentence (the `coggit` entry
 *   pointer) when printing (`coggit instructions`) — mechanics stay in the
 *   CLI's `--help`.
 *
 * One canonical term: the paired document is always a "cognition document";
 * "cognition layer" names the collective. The dsh enrichment directive and
 * the MCP re-addressing keep the same vocabulary.
 */

export type CoggitSystemPromptKind = 'minimal' | 'standard';

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
    'CogGit mirrors the source tree with a cognition layer: each source file or folder has a paired cognition document at the same source-relative path — a file is mirrored by `<source path>.md`, a folder by the `README.md` at its mirrored path — recording design intent, contracts, boundaries, and invariants rather than implementation summaries. Use it to explore the codebase, and when changing code, keep the paired cognition document up to date.',
};

/**
 * Stable per-line identities for the `standard` form. Hosts that re-address
 * the form (MCP: tool names / resource URIs) map over these keys instead of
 * string-replacing the content; keys are part of the host-facing seam and
 * must not be renamed or reordered casually.
 */
export const STANDARD_PROMPT_SEGMENT_KEYS = [
  'roots',
  'records',
  'mirror',
  'snapshot',
  'indexing',
  'delegation',
  'upkeep',
  'contradictions',
] as const;

export type StandardPromptSegmentKey = (typeof STANDARD_PROMPT_SEGMENT_KEYS)[number];

export interface StandardPromptSegment {
  key: StandardPromptSegmentKey;
  text: string;
}

/**
 * The standard form, segment by segment: the operational guidance an agent
 * needs to actually use CogGit (read roots first, read cognition before
 * source, delegate source-scoped maintenance, verify with status), stated
 * with operations referenced by name only — hosts spell them for their own
 * surface at their access seam.
 */
export const STANDARD_SYSTEM_PROMPT_SEGMENTS: readonly StandardPromptSegment[] = [
  {
    key: 'roots',
    text: 'Establish the project\'s source and cognition roots before locating cognition documents — the status operation names both roots in its header.',
  },
  {
    key: 'records',
    text: 'CogGit cognition documents record design intent, contracts, boundaries, and invariants, not implementation summaries.',
  },
  {
    key: 'mirror',
    text: 'CogGit cognition is a mirrored design layer over the source tree: a file\'s cognition document is the design counterpart of the same source-relative path with `.md` appended (`src/foo.ts` pairs with `src/foo.ts.md`), and a folder\'s cognition document is the README.md at that folder\'s mirrored path.',
  },
  {
    key: 'snapshot',
    text: 'Before reading source code in a project configured for CogGit, locate the relevant cognition document — via per-path status, which names the file\'s paired cognition document, or the mirror convention — and inspect it when it can inform the task.',
  },
  {
    key: 'indexing',
    text: 'CogGit\'s tools index the same cognition layer agents can grep/read directly: use them to narrow candidates, check freshness, and choose better sourcePath/file-search targets, while grep/read remains the primary way to inspect full cognition text.',
  },
  {
    key: 'delegation',
    text: 'CogGit cognition maintenance is source-scoped and suitable for subagents: delegate independent sourcePath updates along with the relevant handbook guidance for the cognition kind.',
  },
  {
    key: 'upkeep',
    text: 'When changing code in a project configured for CogGit, keep the paired cognition document up to date.',
  },
  {
    key: 'contradictions',
    text: 'Report contradictions between source, cognition, design intent, or the requested change before editing a cognition document; do not silently resolve uncertainty, and verify edited nodes with the status operation.',
  },
];

export const STANDARD_SYSTEM_PROMPT: CoggitSystemPrompt = {
  kind: 'standard',
  version: 'system-prompt-v1',
  content: STANDARD_SYSTEM_PROMPT_SEGMENTS.map((segment) => segment.text).join('\n'),
};

const SYSTEM_PROMPTS: Record<CoggitSystemPromptKind, CoggitSystemPrompt> = {
  minimal: MINIMAL_SYSTEM_PROMPT,
  standard: STANDARD_SYSTEM_PROMPT,
};

export function getCoggitSystemPrompt(
  kind: CoggitSystemPromptKind = 'minimal',
): CoggitSystemPrompt {
  return SYSTEM_PROMPTS[kind];
}
