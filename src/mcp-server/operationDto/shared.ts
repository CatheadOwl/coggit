import { z } from 'zod';

import { externalPathFromString, type CognitionKind } from '@coggit/core';
import type { CoggitOperationAction, CoreOperationId } from '@coggit/core';
import type { UriComponents } from '@coggit/core';

export const observedStatusSchema = z.enum(['fresh', 'stale', 'conflict']).nullable();

/**
 * MCP owns its model-facing tool names; core hints only carry surface-neutral
 * operation ids. This map is the single place where the MCP surface derives
 * its tool names from core operation ids.
 */
export const MCP_TOOL_NAMES = {
  snapshot: 'coggit_snapshot',
  status: 'coggit_status',
  add: 'coggit_add',
  resolve: 'coggit_resolve',
  routes: 'coggit_routes',
} as const satisfies Record<CoreOperationId, string>;

export const operationActionSchema = z.object({
  code: z.string(),
  label: z.string(),
  tool: z.enum(['coggit_snapshot', 'coggit_status', 'coggit_add', 'coggit_resolve', 'coggit_routes']).optional(),
  handbookUri: z.string().optional(),
  sourcePath: z.string().optional(),
  scope: z.enum(['tracked', 'untracked', 'issues', 'all']).optional(),
  maxDepth: z.number().int().nonnegative().optional(),
});

/**
 * Maps a surface-neutral core action to MCP addressing: `operation` → tool
 * name, `handbookId` → handbook resource URI (the same mapping the top-level
 * `handbookId` receives). A handbook-bearing action stays mappable without
 * carrying an `operation`.
 */
export function toMcpOperationAction(
  action: CoggitOperationAction,
): z.infer<typeof operationActionSchema> {
  const { operation, handbookId, ...rest } = action;
  return {
    ...rest,
    ...(operation ? { tool: MCP_TOOL_NAMES[operation] } : {}),
    ...(handbookId ? { handbookUri: handbookUri(handbookId) } : {}),
  };
}

export const projectContextSchema = z.object({
  label: z.string(),
  projectRoot: z.string(),
  sourceRoot: z.string(),
  cognitionRoot: z.string(),
  sourcePathRule: z.string(),
});

export const mcpStatusIssueSchema = z.object({
  sourcePath: z.string(),
  cognitionPath: z.string().nullable(),
  severity: z.enum(['info', 'warning', 'error']),
  message: z.string(),
  suggestedActions: z.array(z.string()),
});

export const mcpMaintenanceNextActionSchema = z.object({
  code: z.string(),
  label: z.string(),
  kind: z.enum(['read-resource', 'read-cognition']),
  priority: z.number().min(0).max(1),
  resourceUri: z.string().optional(),
  cognitionPath: z.string().optional(),
});

export function toMcpProjectContext(project: {
  label: string;
  projectRootUri: string;
  sourceRoot: string;
  cognitionRoot: string;
  sourcePathRule: string;
}): z.infer<typeof projectContextSchema> {
  return {
    label: project.label,
    projectRoot: externalPathFromString(project.projectRootUri),
    sourceRoot: project.sourceRoot,
    cognitionRoot: project.cognitionRoot,
    sourcePathRule: project.sourcePathRule,
  };
}

export function handbookUri(kind: CognitionKind): string {
  return `coggit://handbook/${kind}`;
}

export function handbookResourceLink(kind: CognitionKind): {
  type: 'resource_link';
  uri: string;
  name: string;
  mimeType: string;
  description: string;
} {
  const label = kind === 'skeleton' ? 'skeleton' : 'leaf';
  return {
    type: 'resource_link',
    uri: handbookUri(kind),
    name: `CogGit ${label} handbook`,
    mimeType: 'text/markdown',
    description: `Authoring guidance for ${label} cognition documents.`,
  };
}

export function createHandbookMaintenanceAction(input: {
  handbookUri: string;
  label: string;
  priority?: number;
}): z.infer<typeof mcpMaintenanceNextActionSchema> {
  return {
    code: 'read-handbook-before-maintenance',
    label: input.label,
    kind: 'read-resource',
    priority: input.priority ?? 1,
    resourceUri: input.handbookUri,
  };
}
