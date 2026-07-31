import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  assembleRoutesContent,
  DEFAULT_ROUTES_DEPTH,
  routesOperation,
  toRoutesStructuredOutput,
} from '../../core/index.js';
import type { CoggitProject } from '../../core/interfaces.js';
import { routesContentText } from '../../format/index.js';
import { MCP_TOOL_SURFACES } from '../../promptAssets.js';
import { routesOperationOutputSchema } from '../operationDto/index.js';

export function registerRoutesTool(
  server: McpServer,
  getProjects: () => Promise<CoggitProject[]>,
): RegisteredTool {
  return server.registerTool(
    'coggit_routes',
    {
      title: MCP_TOOL_SURFACES.routes.title,
      description: MCP_TOOL_SURFACES.routes.description,
      inputSchema: {
        sourcePath: z
          .string()
          .optional()
          .describe('Path relative to the configured source root. Paths that include the configured source root prefix are normalized. Use "." for the source root itself.'),
        depth: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Maximum tree depth from the selected route root. Defaults to 2 for a broad route overview. Increase to expand deeper branches.'),
        format: z
          .enum(['flat', 'tree'])
          .optional()
          .describe('Output shape. Defaults to a flat route index: tree-ordered path lines with summaries and truncation markers. Use tree for a nested parent-child view.'),
      },
      outputSchema: routesOperationOutputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ sourcePath, depth, format }) => {
      const effectiveDepth = depth ?? DEFAULT_ROUTES_DEPTH;
      const effectiveFormat = format ?? 'flat';
      const projects = await getProjects();

      const result = projects.length > 0
        ? await routesOperation(projects[0], { includeHeadings: false })
        : null;

      const content = assembleRoutesContent(
        {
          entries: result?.entries ?? [],
          project: result?.project ?? { sourceRoot: '', cognitionRoot: '' },
        },
        {
          sourcePath,
          depth: effectiveDepth,
          format: effectiveFormat,
          projectRootUri: projects[0]?.root.projectRootUri,
          sourceRootUri: projects[0]?.root.sourceRootUri,
        },
      );

      return {
        content: [{ type: 'text' as const, text: routesContentText(content, 'mcp') }],
        structuredContent: toRoutesStructuredOutput(content),
      };
    },
  );
}
