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
import { formatOperationAction, formatProjectContext, joinMcpSections, type ToolContent } from './toolShared.js';

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
  const sections: string[] = [];

  const actionable = result.suggestedActions
    .filter((action) => action.tool || action.handbookUri)
    .map((action) => formatOperationAction(action));
  if (actionable.length > 0) {
    sections.push([
      'Suggested next actions:',
      ...actionable.map((action) => `- ${action}`),
    ].join('\n'));
  }

  // Subtree workflow channel: triage entries are the authoritative surface for
  // descendant-scoped actions; top-level actions stay the inspected node's
  // direct next steps, so no cross-channel deduplication is needed.
  const triageLines: string[] = [];
  for (const entry of result.triage?.entries ?? []) {
    const entryActionable = entry.suggestedActions
      .filter((action) => action.tool || action.handbookUri)
      .map((action) => formatOperationAction(action));
    if (entryActionable.length === 0) {
      continue;
    }
    triageLines.push(`- ${entry.sourcePath}:`);
    triageLines.push(...entryActionable.map((action) => `  - ${action}`));
  }
  if (triageLines.length > 0) {
    sections.push([
      'Subtree triage (per-descendant maintenance steps):',
      ...triageLines,
    ].join('\n'));
  }

  if (result.nextActions.length > 0) {
    sections.push([
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
    ].join('\n'));
  }

  return sections.join('\n\n');
}
