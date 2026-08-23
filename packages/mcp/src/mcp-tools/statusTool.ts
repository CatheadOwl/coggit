import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  pathHintsTryText,
  pathMissMessage,
  renderStatusAgentInspectionText,
  statusOperation,
} from '@coggit/core';
import type { StatusOperationResult } from '@coggit/core';
import type { CoggitProject } from '@coggit/core';
import { MCP_TOOL_SURFACES } from '../promptAssets.js';
import {
  handbookResourceLink,
  statusMcpView,
  statusOperationOutputSchema,
  statusStructuredContent,
} from '../operationDto/index.js';
import { formatProjectContext, joinMcpSections, type ToolContent } from './toolShared.js';

export function registerStatusTool(
  server: McpServer,
  getProjects: () => Promise<CoggitProject[]>,
): RegisteredTool {
  return server.registerTool(
    'coggit_status',
    {
      title: MCP_TOOL_SURFACES.status.title,
      description: MCP_TOOL_SURFACES.status.description,
      inputSchema: {
        sourcePath: z
          .string()
          .optional()
          .describe('Source-root-relative path, e.g. src/main.ts or src/app. Defaults to root when not provided. Do not pass an absolute filesystem path.'),
      },
      outputSchema: statusOperationOutputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ sourcePath }) => {
      const effectivePath = sourcePath ?? '.';
      const result = await statusOperation(await getProjects(), effectivePath);
      const view = statusMcpView(result);
      const content: ToolContent[] = [
        {
          type: 'text' as const,
          text: statusText(result),
        },
      ];

      if (result.handbookId) {
        content.push(handbookResourceLink(result.handbookId));
      }

      return {
        content,
        structuredContent: statusStructuredContent(view),
      };
    },
  );
}

function statusText(result: StatusOperationResult): string {
  if (!result.found || !result.inspection) {
    const lines = [result.pathMissMessage ?? pathMissMessage(result.sourcePath)];
    if (result.pathHintMessage && result.pathHints.length > 0) {
      lines.push(result.pathHintMessage);
      lines.push(pathHintsTryText(result.pathHints));
    }
    return lines.join('\n');
  }
  return joinMcpSections(
    result.project ? formatProjectContext([result.project]) : '',
    renderStatusAgentInspectionText(result.inspection),
  );
}

export const __testing__ = {
  statusText,
};
