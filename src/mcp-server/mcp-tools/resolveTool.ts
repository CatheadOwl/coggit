import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { reviewUnchangedOperation } from '../../core/index.js';
import type { ReviewUnchangedOperationResult } from '../../core/index.js';
import type { CoggitProject } from '../../core/interfaces.js';
import { MCP_TOOL_SURFACES } from '../../promptAssets.js';
import {
  RESOLVE_REVIEWED_UNCHANGED,
  resolveOperationOutputSchema,
  resolveStructuredContent,
} from '../operationDto/index.js';
import { formatTimestamp } from '../../core/time.js';
import type { ToolContent } from './toolShared.js';

export function registerResolveTool(
  server: McpServer,
  getProjects: () => Promise<CoggitProject[]>,
): RegisteredTool {
  return server.registerTool(
    'coggit_resolve',
    {
      title: MCP_TOOL_SURFACES.resolve.title,
      description: MCP_TOOL_SURFACES.resolve.description,
      inputSchema: {
        sourcePath: z
          .string()
          .describe('Source-root-relative path for the stale source/cognition node to resolve. Do not pass an absolute filesystem path.'),
        resolution: z
          .literal(RESOLVE_REVIEWED_UNCHANGED)
          .describe('Resolution mode. Use reviewed_unchanged only after reviewing source and cognition and confirming no cognition text edit is needed.'),
      },
      outputSchema: resolveOperationOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ sourcePath }) => {
      const result = await reviewUnchangedOperation(await getProjects(), sourcePath);
      const content: ToolContent[] = [
        {
          type: 'text' as const,
          text: resolveText(result),
        },
      ];

      return {
        content,
        structuredContent: resolveStructuredContent(result),
      };
    },
  );
}

function resolveText(result: ReviewUnchangedOperationResult): string {
  if (!result.success) {
    return `Resolve failed for ${result.sourcePath}: ${result.error?.message ?? 'Unknown error'}`;
  }

  return [
    'Resolved: reviewed unchanged',
    `Source path: ${result.sourcePath}`,
    `Cognition path: ${result.cognitionPath ?? '(none)'}`,
    `Source key: ${result.sourceKey ?? '(none)'}`,
    `Verification time: ${formatTimestamp(result.verificationTimeMs, '(none)')}`,
    `Next: verify with ${result.verify.tool} for ${result.verify.sourcePath}.`,
  ].join('\n');
}
