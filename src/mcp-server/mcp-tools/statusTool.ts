import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  pathHintsTryText,
  pathMissMessage,
  projectStatusPresentation,
  renderStatusPresentation,
  statusOperation,
} from '../../core/index.js';
import type { StatusOperationResult } from '../../core/index.js';
import type { CoggitProject } from '../../core/interfaces.js';
import { MCP_TOOL_SURFACES } from '../../promptAssets.js';
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
          text: joinMcpSections(statusText(result), statusGuidanceText(view)),
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
    renderStatusPresentation(projectStatusPresentation(result.inspection), 'text'),
  );
}

function statusGuidanceText(result: ReturnType<typeof statusMcpView>): string {
  if (result.nextActions.length === 0) {
    return '';
  }

  return [
    'Maintenance guidance:',
    'If you will maintain this cognition, read the matching handbook before editing:',
    ...result.nextActions.map((action) => {
      if (action.kind === 'read-resource' && action.resourceUri) {
        return `- Read ${action.resourceUri}: ${action.label}`;
      }
      if (action.kind === 'read-cognition' && action.cognitionPath) {
        return `- Read cognition ${action.cognitionPath}: ${action.label}`;
      }
      return `- ${action.label}`;
    }),
  ].join('\n');
}
