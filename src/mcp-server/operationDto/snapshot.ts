import { z } from 'zod';

import type {
  SnapshotOperationResult,
} from '../../core/index.js';
import type { TreeProjectionNode } from '../../core/types.js';
import { projectContextSchema, operationActionSchema, toMcpOperationAction, toMcpProjectContext } from './shared.js';

export const leanSnapshotNodeSchema: z.ZodType<ReturnType<typeof toLeanSnapshotNode>> = z.lazy(() => z.object({
  path: z.string(),
  cognition: z.string().optional(),
  observedStatus: z.enum(['fresh', 'stale', 'conflict']).nullable().optional(),
  children: z.array(leanSnapshotNodeSchema).optional(),
}));

export function toLeanSnapshotNode(node: TreeProjectionNode): {
  path: string;
  cognition?: string;
  observedStatus?: 'fresh' | 'stale' | 'conflict' | null;
  children?: ReturnType<typeof toLeanSnapshotNode>[];
} {
  return {
    path: node.path,
    ...(node.cognition ? { cognition: node.cognition } : {}),
    ...(node.observedStatus !== undefined ? { observedStatus: node.observedStatus } : {}),
    ...(node.children && node.children.length > 0
      ? { children: node.children.map(toLeanSnapshotNode) }
      : {}),
  };
}

export const snapshotOperationOutputSchema = {
  scope: z.enum(['tracked', 'untracked', 'issues', 'all']),
  tree: z.array(leanSnapshotNodeSchema),
  meta: z.object({
    found: z.boolean(),
    sourcePath: z.string().nullable(),
    projectCount: z.number().int().nonnegative(),
    trackedCount: z.number().int().nonnegative(),
    untrackedCount: z.number().int().nonnegative(),
    issueCount: z.number().int().nonnegative(),
    maxDepth: z.number().int().nonnegative().nullable(),
    truncated: z.boolean(),
    omittedChildrenCount: z.number().int().nonnegative(),
  }),
  projects: z.array(projectContextSchema),
  nextScopes: z.array(z.enum(['tracked', 'untracked', 'issues', 'all'])),
  suggestedActions: z.array(operationActionSchema),
  pathHints: z.array(z.string()),
  pathMissMessage: z.string().optional(),
  pathHintMessage: z.string().optional(),
};

export interface SnapshotMcpView {
  [key: string]: unknown;
  scope: SnapshotOperationResult['scope'];
  tree: ReturnType<typeof toLeanSnapshotNode>[];
  meta: {
    found: boolean;
    sourcePath: string | null;
    projectCount: number;
    trackedCount: number;
    untrackedCount: number;
    issueCount: number;
    maxDepth: number | null;
    truncated: boolean;
    omittedChildrenCount: number;
  };
  projects: Array<z.infer<typeof projectContextSchema>>;
  nextScopes: SnapshotOperationResult['nextScopes'];
  suggestedActions: Array<z.infer<typeof operationActionSchema>>;
  pathHints: string[];
  pathMissMessage?: string;
  pathHintMessage?: string;
}

export function snapshotMcpView(result: SnapshotOperationResult, options: { tree: TreeProjectionNode[] }): SnapshotMcpView {
  return {
    scope: result.scope,
    tree: options.tree.map(toLeanSnapshotNode),
    meta: {
      found: result.found,
      sourcePath: result.sourcePath,
      projectCount: result.projectCount,
      trackedCount: result.trackedCount,
      untrackedCount: result.untrackedCount,
      issueCount: result.issueCount,
      maxDepth: result.maxDepth,
      truncated: result.truncated,
      omittedChildrenCount: result.omittedChildrenCount,
    },
    projects: result.projects.map(toMcpProjectContext),
    nextScopes: result.nextScopes,
    suggestedActions: result.suggestedActions.map(toMcpOperationAction),
    pathHints: result.pathHints,
    ...(result.pathMissMessage ? { pathMissMessage: result.pathMissMessage } : {}),
    ...(result.pathHintMessage ? { pathHintMessage: result.pathHintMessage } : {}),
  };
}

export function snapshotStructuredContent(view: SnapshotMcpView): SnapshotMcpView {
  return view;
}
