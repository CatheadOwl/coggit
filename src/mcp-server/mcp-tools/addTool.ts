import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { addOperation, renderPathMissText } from '../../core/index.js';
import type { AddOperationResult } from '../../core/index.js';
import type { CoggitProject } from '../../core/interfaces.js';
import { MCP_TOOL_SURFACES } from '../../promptAssets.js';
import {
  MCP_TOOL_NAMES,
  addOperationOutputSchema,
  addStructuredContent,
  handbookResourceLink,
  handbookUri,
} from '../operationDto/index.js';
import type { ToolContent } from './toolShared.js';

export function registerAddTool(
  server: McpServer,
  getProjects: () => Promise<CoggitProject[]>,
): RegisteredTool {
  return server.registerTool(
    'coggit_add',
    {
      title: MCP_TOOL_SURFACES.add.title,
      description: MCP_TOOL_SURFACES.add.description,
      inputSchema: {
        sourcePath: z
          .string()
          .describe('Source-root-relative path to an existing source file or folder, e.g. src/main.ts or src/app. Do not pass an absolute filesystem path.'),
        kind: z
          .enum(['auto', 'leaf', 'skeleton'])
          .optional()
          .describe('auto chooses leaf for files and skeleton for folders. Use leaf only for files and skeleton only for folders. Defaults to auto.'),
        overwrite: z
          .boolean()
          .optional()
          .describe('Replace existing cognition content when true. Defaults to false. Do not enable without explicit user approval.'),
      },
      outputSchema: addOperationOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ sourcePath, kind, overwrite }) => {
      const result = await addOperation(await getProjects(), sourcePath, {
        kind: kind ?? 'auto',
        overwrite: overwrite ?? false,
      });
      const content: ToolContent[] = [
        {
          type: 'text' as const,
          text: addText(result),
        },
      ];

      if (result.handbookId) {
        content.push(handbookResourceLink(result.handbookId));
      }

      return {
        content,
        structuredContent: addStructuredContent(result),
      };
    },
  );
}

function addText(result: AddOperationResult): string {
  if (!result.success) {
    if (result.error?.code === 'path-not-found') {
      return renderPathMissText(result);
    }
    return `Add failed for ${result.sourcePath}: ${result.error?.message ?? 'Unknown error'}`;
  }

  const handbook = result.handbookId ? handbookUri(result.handbookId) : null;
  return [
    `Created: ${result.created ? 'yes' : 'no, cognition already existed'}`,
    `Kind: ${result.kind}`,
    `Source path: ${result.sourcePath}`,
    `Cognition path: ${result.cognitionPath}`,
    handbook
      ? `Next: read ${handbook}, update only the paired cognition document with design intent/contracts/boundaries rather than implementation summaries, then verify with ${MCP_TOOL_NAMES[result.verify.operation]} for ${result.verify.sourcePath}.`
      : `Next: verify with ${MCP_TOOL_NAMES[result.verify.operation]} for ${result.verify.sourcePath}.`,
  ].join('\n');
}
