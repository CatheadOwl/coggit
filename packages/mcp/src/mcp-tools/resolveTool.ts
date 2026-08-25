import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { renderPathMissText, resolveOperation } from '@coggit/core';
import type { ResolveOperationResult } from '@coggit/core';
import type { CoggitProject } from '@coggit/core';
import { MCP_TOOL_SURFACES } from '../promptAssets.js';
import {
  resolveOperationOutputSchema,
  resolveStructuredContent,
} from '../operationDto/index.js';
import { formatTimestamp } from '@coggit/core/internal';
import { recheckNextStepText, type ToolContent } from './toolShared.js';

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
          .describe('Project-root-relative path for the stale source/cognition node to resolve. Do not pass an absolute filesystem path.'),
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
      const result = await resolveOperation(await getProjects(), sourcePath);
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

function resolveText(result: ResolveOperationResult): string {
  if (!result.success) {
    if (result.error?.code === 'path-not-found') {
      return renderPathMissText(result);
    }
    return [
      `Resolve failed for ${result.sourcePath}: ${result.error?.message ?? 'Unknown error'}`,
      recheckNextStepText(result.suggestedActions),
    ].filter(Boolean).join('\n');
  }

  return [
    'Resolved',
    `Source path: ${result.sourcePath}`,
    `Cognition path: ${result.cognitionPath ?? '(none)'}`,
    `Source key: ${result.sourceKey ?? '(none)'}`,
    `Verification time: ${formatTimestamp(result.verificationTimeMs, '(none)')}`,
  ].join('\n');
}

export const __testing__ = {
  resolveText,
};
