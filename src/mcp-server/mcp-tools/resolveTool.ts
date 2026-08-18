import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { renderPathMissText, resolveOperation } from '../../core/index.js';
import type { ResolveOperationResult } from '../../core/index.js';
import type { CoggitProject } from '../../core/interfaces.js';
import { MCP_TOOL_SURFACES } from '../../promptAssets.js';
import {
  MCP_TOOL_NAMES,
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
      `Next: verify with ${MCP_TOOL_NAMES[result.verify.operation]} for ${result.verify.sourcePath}.`,
    ].join('\n');
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
