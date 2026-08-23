import { z } from 'zod';

import {
  flattenRoutesProjection,
  projectRoutesEntries,
  routeProjectionLineText,
  type RoutesOperationResult,
} from '@coggit/core';
import type { RoutesProjectionNode } from '@coggit/core/internal';

export const routesProjectionNodeSchema: z.ZodType<RoutesProjectionNode> = z.lazy(() => z.object({
  path: z.string(),
  cognition: z.string().optional(),
  description: z.string().optional(),
  truncated: z.boolean().optional(),
  omittedChildrenCount: z.number().int().nonnegative().optional(),
  children: z.array(routesProjectionNodeSchema).optional(),
}));

export const routesOperationOutputSchema = {
  project: z.object({
    sourceRoot: z.string(),
    cognitionRoot: z.string(),
  }),
  depth: z.number().int().nonnegative(),
  sourcePath: z.string().optional(),
  pathMissMessage: z.string().optional(),
  pathHintMessage: z.string().optional(),
  pathHints: z.array(z.string()).optional(),
  routes: z.array(z.string()).optional(),
  tree: z.array(routesProjectionNodeSchema).optional(),
};

export interface RoutesStructuredContentOptions {
  format?: 'flat' | 'tree';
  tree?: RoutesProjectionNode[];
  depth?: number;
  sourcePath?: string;
  pathMissMessage?: string;
  pathHintMessage?: string;
  pathHints?: string[];
}

export type RoutesStructuredContent =
  | {
      project: {
        sourceRoot: string;
        cognitionRoot: string;
      };
      depth: number;
      sourcePath?: string;
      pathMissMessage?: string;
      pathHintMessage?: string;
      pathHints?: string[];
      routes: string[];
      tree?: never;
    }
  | {
      project: {
        sourceRoot: string;
        cognitionRoot: string;
      };
      depth: number;
      sourcePath?: string;
      pathMissMessage?: string;
      pathHintMessage?: string;
      pathHints?: string[];
      tree: RoutesProjectionNode[];
      routes?: never;
    };

export function routesStructuredContent(
  result: RoutesOperationResult,
  options: RoutesStructuredContentOptions = {},
): RoutesStructuredContent {
  const format = options.format ?? 'flat';
  const tree = options.tree ?? projectRoutesEntries(result.entries);

  const content = {
    project: {
      sourceRoot: result.project.sourceRoot,
      cognitionRoot: result.project.cognitionRoot,
    },
    depth: options.depth ?? 2,
    ...(options.sourcePath !== undefined ? { sourcePath: options.sourcePath } : {}),
    ...(options.pathMissMessage ? { pathMissMessage: options.pathMissMessage } : {}),
    ...(options.pathHintMessage ? { pathHintMessage: options.pathHintMessage } : {}),
    ...(options.pathHints && options.pathHints.length > 0 ? { pathHints: options.pathHints } : {}),
  };

  return format === 'tree'
    ? { ...content, tree }
    : { ...content, routes: flattenRoutesProjection(tree).map(routeProjectionLineText) };
}
