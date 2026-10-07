import {
  STANDARD_SYSTEM_PROMPT_SEGMENTS,
  type StandardPromptSegmentKey,
} from '@coggit/core';

import { MCP_TOOL_NAMES } from './operationDto/shared.js';
import { COGNITION_ROOTS_RESOURCE_URI } from './resources.js';

/**
 * The server `instructions`, derived at runtime from the host-agnostic
 * `standard` system-prompt form owned by `@coggit/core`. This module is the
 * MCP host's access layer: the body references operations by name with zero
 * surface spellings, and the overrides below supply the MCP spellings —
 * tool names and resource URIs through the existing seams. `roots` and
 * `indexing` remain sentence-level re-voices (the access action genuinely
 * differs per host); every other segment passes through byte-equal to core,
 * so the universal body stays the single wording authority.
 */
const MCP_SEGMENT_OVERRIDES: Readonly<Partial<Record<StandardPromptSegmentKey, string>>> = {
  roots: `Read ${COGNITION_ROOTS_RESOURCE_URI} before locating cognition documents.`,
  snapshot: `Before reading source code in a tracked project, use ${MCP_TOOL_NAMES.snapshot} to locate the relevant cognition document — or derive its path by the mirror convention — and inspect that cognition layer when it can inform the task.`,
  indexing:
    'CogGit MCP indexes the same cognition layer agents can grep/read directly: use its tools to narrow candidates, check freshness, and choose better sourcePath/file-search targets, while grep/read remains the primary way to inspect full cognition text.',
  delegation:
    'CogGit cognition maintenance is source-scoped and suitable for subagents: delegate independent sourcePath updates along with the relevant coggit://handbook/<kind> resource.',
  contradictions: `Report contradictions between source, cognition, design intent, or the requested change before editing a cognition document; do not silently resolve uncertainty, and verify edited nodes with ${MCP_TOOL_NAMES.status}.`,
};

export const MCP_SERVER_INSTRUCTIONS = STANDARD_SYSTEM_PROMPT_SEGMENTS.map(
  (segment) => MCP_SEGMENT_OVERRIDES[segment.key] ?? segment.text,
).join('\n');
