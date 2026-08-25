import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  pathHintsTryText,
  pathMissMessage,
  projectSnapshotTree,
  projectTreeFromSnapshot,
  snapshotOperation,
} from '@coggit/core';
import type {
  SnapshotOperationResult,
} from '@coggit/core';
import type { CoggitProject } from '@coggit/core';
import { nodeSnapshotTreeText, snapshotTreeText } from '@coggit/format';
import { MCP_TOOL_SURFACES } from '../promptAssets.js';
import {
  snapshotMcpView,
  snapshotOperationOutputSchema,
  snapshotStructuredContent,
} from '../operationDto/index.js';
import { formatOperationAction, formatProjectContext, joinMcpSections } from './toolShared.js';

const DEFAULT_MCP_SNAPSHOT_MAX_DEPTH = 2;

export function registerSnapshotTool(
  server: McpServer,
  getProjects: () => Promise<CoggitProject[]>,
): RegisteredTool {
  return server.registerTool(
    'coggit_snapshot',
    {
      title: MCP_TOOL_SURFACES.snapshot.title,
      description: MCP_TOOL_SURFACES.snapshot.description,
      inputSchema: {
        sourcePath: z
          .string()
          .optional()
          .describe('Project-root-relative path to start from, e.g. src/main.ts, src/app, or ".". Do not pass an absolute filesystem path.'),
        scope: z
          .enum(['tracked', 'untracked', 'issues', 'all'])
          .optional()
          .describe('Optional. Leave unset for the normal tracked cognition view. Use untracked to inspect missing cognition, but do not proactively add nodes; only use coggit_add when a node is clearly critical and worth formalizing now. Use issues for stale/conflict maintenance. Use all only for exhaustive diagnostics or debugging; it is noisy and should not be the normal starting point.'),
        maxDepth: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Maximum tree depth below the selected source path. Defaults to 2 in MCP for shallow structure exploration. 0 returns only the selected node. Increase after selecting a branch, then use coggit_status for focused diagnosis.'),
      },
      outputSchema: snapshotOperationOutputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ sourcePath, scope, maxDepth }) => {
      const effectiveMaxDepth = maxDepth ?? DEFAULT_MCP_SNAPSHOT_MAX_DEPTH;
      const result = await snapshotOperation(await getProjects(), { sourcePath, scope, maxDepth: effectiveMaxDepth });
      const text = snapshotText(result);
      const tree = result.node
        ? projectTreeFromSnapshot(result.node, { depth: effectiveMaxDepth, scope })
        : result.snapshot
          ? projectSnapshotTree(result.snapshot, { depth: effectiveMaxDepth, scope })
          : [];
      const view = snapshotMcpView(result, { tree });
      return {
        content: [
          {
            type: 'text' as const,
            text: joinMcpSections(
              `Snapshot scope: ${view.scope}`,
              formatProjectContext(view.projects),
              text,
              snapshotGuidanceText(view),
            ),
          },
        ],
        structuredContent: snapshotStructuredContent(view),
      };
    },
  );
}

function snapshotText(result: SnapshotOperationResult): string {
  if (!result.found) {
    const lines = [result.pathMissMessage ?? pathMissMessage(result.sourcePath ?? '')];
    if (result.pathHintMessage && result.pathHints.length > 0) {
      lines.push(result.pathHintMessage);
      lines.push(pathHintsTryText(result.pathHints));
    }
    return lines.join('\n');
  }
  if (result.node) {
    return nodeSnapshotTreeText(result.node, { scope: result.scope, maxDepth: result.maxDepth ?? undefined });
  }
  if (result.snapshot) {
    return snapshotTreeText(result.snapshot, { scope: result.scope, maxDepth: result.maxDepth ?? undefined });
  }
  return 'No matching nodes found.';
}

function snapshotGuidanceText(result: ReturnType<typeof snapshotMcpView>): string {
  const lines: string[] = [];

  if (result.meta.maxDepth !== null) {
    lines.push(`Rendered depth: ${result.meta.maxDepth}`);
  }
  if (result.meta.truncated) {
    lines.push(`Tree truncated: ${result.meta.omittedChildrenCount} child node(s) omitted. Increase maxDepth or pass sourcePath to expand a branch.`);
  }

  const actionable = result.suggestedActions
    .filter((action) => action.tool)
    .map((action) => formatOperationAction(action));
  if (actionable.length > 0) {
    lines.push('Suggested next actions:');
    lines.push(...actionable.map((action) => `- ${action}`));
  }

  return lines.join('\n');
}
