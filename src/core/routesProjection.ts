import type { CognitionRoutesEntry, RoutesProjectionNode } from './types.js';
import type { UriComponents } from './interfaces.js';
import { normalizeSourcePathInput } from './mapping.js';
import { suggestPathHints } from './pathHints.js';
import { applyTreeDepth } from './projection.js';

export const DEFAULT_ROUTES_DEPTH = 2;

export interface RouteProjectionLine {
  path: string;
  cognition?: string;
  description?: string;
  truncated?: boolean;
  omittedChildrenCount?: number;
}

export interface RoutesSourcePathContext {
  sourceRoot?: string;
  projectRootUri?: UriComponents;
  sourceRootUri?: UriComponents;
}

export interface RoutesSourcePathSelection {
  normalizedSourcePath?: string;
  nodes: RoutesProjectionNode[];
  missed: boolean;
  pathHints: string[];
}

export function projectRoutesEntries(
  entries: readonly CognitionRoutesEntry[],
): RoutesProjectionNode[] {
  return buildRoutesProjectionTree(entries.map((entry) => ({
    routePath: entry.toolSourcePath ?? entry.cognitionPath,
    cognitionPath: entry.cognitionPath,
    description: routeDescription(entry),
  })));
}

export function flattenRoutesProjection(
  nodes: readonly RoutesProjectionNode[],
): RouteProjectionLine[] {
  return nodes.flatMap((node) => [
    ...(node.cognition || node.truncated
      ? [{
          path: node.path,
          ...(node.cognition ? { cognition: node.cognition } : {}),
          ...(node.description ? { description: node.description } : {}),
          ...(node.truncated ? { truncated: node.truncated } : {}),
          ...(node.omittedChildrenCount !== undefined ? { omittedChildrenCount: node.omittedChildrenCount } : {}),
        }]
      : []),
    ...(node.children ? flattenRoutesProjection(node.children) : []),
  ]);
}

export function routeProjectionLineText(route: RouteProjectionLine): string {
  const target = route.cognition ?? route.path;
  const prefix = route.truncated
    ? `[truncated: ${route.omittedChildrenCount ?? 0}] `
    : '';
  return route.description
    ? `${prefix}${target} | ${route.description}`
    : `${prefix}${target}`;
}

export function selectRoutesBySourcePath(
  tree: readonly RoutesProjectionNode[],
  sourcePath?: string,
  context?: RoutesSourcePathContext,
): RoutesSourcePathSelection {
  const normalizedSourcePath = sourcePath
    ? normalizeSourcePathInput(sourcePath, context)
    : undefined;

  if (!normalizedSourcePath || normalizedSourcePath === '' || normalizedSourcePath === '.') {
    return { nodes: [...tree], missed: false, pathHints: [] };
  }

  const nodes = selectRouteSubtree(tree, normalizedSourcePath);
  const missed = nodes.length === 0;
  const pathHints = missed
    ? suggestHintsFromNormalizedPath(tree, normalizedSourcePath)
    : [];

  return { normalizedSourcePath, nodes, missed, pathHints };
}

export function suggestRoutePathHints(
  tree: readonly RoutesProjectionNode[],
  sourcePath: string,
  sourceRoot?: string,
): string[] {
  const normalizedPath = normalizeSourcePathInput(sourcePath, { sourceRoot });
  return suggestHintsFromNormalizedPath(tree, normalizedPath);
}

function suggestHintsFromNormalizedPath(
  tree: readonly RoutesProjectionNode[],
  normalizedPath: string,
): string[] {
  return suggestPathHints(
    flattenRouteNodes(tree).map((node) => node.path),
    normalizedPath,
  );
}

export function applyRoutesFilters(
  tree: readonly RoutesProjectionNode[],
  sourcePath?: string,
  sourceRoot?: string,
): RoutesProjectionNode[] {
  if (!sourcePath) {
    return [...tree];
  }
  const normalizedPath = normalizeSourcePathInput(sourcePath, { sourceRoot });
  if (normalizedPath === '' || normalizedPath === '.') {
    return [...tree];
  }
  return selectRouteSubtree(tree, normalizedPath);
}

function buildRoutesProjectionTree(
  entries: Array<{ routePath: string; cognitionPath: string; description: string | undefined }>,
): RoutesProjectionNode[] {
  const roots: MutableRoutesProjectionNode[] = [];

  for (const entry of entries) {
    const segments = pathSegments(entry.routePath);
    if (segments.length === 0) {
      continue;
    }

    let siblings = roots;
    const currentPath: string[] = [];
    for (const segment of segments) {
      currentPath.push(segment);
      const path = currentPath.join('/');
      let node = siblings.find((candidate) => candidate.path === path);
      if (!node) {
        node = { path, children: [] };
        siblings.push(node);
        siblings.sort(compareRouteTreeNodes);
      }
      siblings = node.children;
    }

    const node = findRouteTreeNode(roots, segments);
    if (node) {
      node.cognition = entry.cognitionPath;
      node.description = entry.description;
    }
  }

  return roots.map(finalizeRouteTreeNode);
}

interface MutableRoutesProjectionNode {
  path: string;
  cognition?: string;
  description?: string;
  truncated?: boolean;
  omittedChildrenCount?: number;
  children: MutableRoutesProjectionNode[];
}

function pathSegments(path: string): string[] {
  return path.split('/').filter((segment) => segment.length > 0 && segment !== '.');
}

function findRouteTreeNode(
  roots: MutableRoutesProjectionNode[],
  segments: string[],
): MutableRoutesProjectionNode | undefined {
  let node: MutableRoutesProjectionNode | undefined;
  let siblings = roots;
  const currentPath: string[] = [];

  for (const segment of segments) {
    currentPath.push(segment);
    node = siblings.find((candidate) => candidate.path === currentPath.join('/'));
    if (!node) {
      return undefined;
    }
    siblings = node.children;
  }

  return node;
}

function compareRouteTreeNodes(
  left: MutableRoutesProjectionNode,
  right: MutableRoutesProjectionNode,
): number {
  return left.path.localeCompare(right.path);
}

function finalizeRouteTreeNode(node: MutableRoutesProjectionNode): RoutesProjectionNode {
  return {
    path: node.path,
    ...(node.cognition ? { cognition: node.cognition } : {}),
    ...(node.description ? { description: node.description } : {}),
    ...(node.truncated ? { truncated: node.truncated } : {}),
    ...(node.omittedChildrenCount !== undefined ? { omittedChildrenCount: node.omittedChildrenCount } : {}),
    ...(node.children.length > 0 ? { children: node.children.map(finalizeRouteTreeNode) } : {}),
  };
}

function routeDescription(entry: CognitionRoutesEntry): string | undefined {
  return entry.identity.description
    ?? entry.identity.retrievalSummary
    ?? entry.document.headings[0]?.text
    ?? undefined;
}

function flattenRouteNodes(nodes: readonly RoutesProjectionNode[]): RoutesProjectionNode[] {
  return nodes.flatMap((node) => [
    node,
    ...(node.children ? flattenRouteNodes(node.children) : []),
  ]);
}

// ─── Presentation assembly ─────────────────────────────────────────────────

export type RoutesPresentationFormat = 'flat' | 'tree';

export interface RoutesPresentationContent {
  project: { sourceRoot: string; cognitionRoot: string };
  depth: number;
  format: RoutesPresentationFormat;
  sourcePath?: string;
  pathMissMessage?: string;
  pathHintMessage?: string;
  pathHints?: string[];
  routes?: string[];
  tree?: RoutesProjectionNode[];
}

export interface AssembleRoutesContentOptions {
  sourcePath?: string;
  depth?: number;
  format?: RoutesPresentationFormat;
  projectRootUri?: UriComponents;
  sourceRootUri?: UriComponents;
}

/**
 * Consumer-agnostic routes presentation pipeline:
 * entries → tree → sourcePath selection → depth truncation → content assembly.
 */
export function assembleRoutesContent(
  input: {
    entries: readonly CognitionRoutesEntry[];
    project: { sourceRoot: string; cognitionRoot: string };
  },
  options: AssembleRoutesContentOptions = {},
): RoutesPresentationContent {
  const depth = options.depth ?? DEFAULT_ROUTES_DEPTH;
  const format = options.format ?? 'flat';
  const baseTree = projectRoutesEntries(input.entries);
  const selection = selectRoutesBySourcePath(baseTree, options.sourcePath, {
    projectRootUri: options.projectRootUri,
    sourceRootUri: options.sourceRootUri,
  });
  const depthResult = applyTreeDepth(selection.nodes, depth);

  const content: RoutesPresentationContent = {
    project: input.project,
    depth,
    format,
    ...(selection.normalizedSourcePath !== undefined ? { sourcePath: selection.normalizedSourcePath } : {}),
    ...(selection.missed ? { pathMissMessage: 'No tracked cognition routes matched the requested source path.' } : {}),
    ...(selection.missed && selection.pathHints.length > 0
      ? { pathHintMessage: 'You may mean one of these source-root-relative route paths.' }
      : {}),
    ...(selection.missed && selection.pathHints.length > 0 ? { pathHints: selection.pathHints } : {}),
  };

  if (format === 'tree') {
    content.tree = depthResult.nodes;
  } else {
    content.routes = flattenRoutesProjection(depthResult.nodes).map(routeProjectionLineText);
  }

  return content;
}

/** Structured output shape: RoutesPresentationContent minus the presentation-only `format` field. */
export type RoutesStructuredOutput = Omit<RoutesPresentationContent, 'format'>;

/** Strip presentation-only fields, yielding the consumer-facing structured payload. */
export function toRoutesStructuredOutput(content: RoutesPresentationContent): RoutesStructuredOutput {
  const { format: _format, ...structured } = content;
  return structured;
}

export function countRouteNodes(nodes: readonly RoutesProjectionNode[]): number {
  let count = 0;
  for (const node of nodes) {
    count++;
    if (node.children) {
      count += countRouteNodes(node.children);
    }
  }
  return count;
}

function selectRouteSubtree(nodes: readonly RoutesProjectionNode[], sourcePath: string): RoutesProjectionNode[] {
  const result: RoutesProjectionNode[] = [];
  for (const node of nodes) {
    if (node.path === sourcePath) {
      return [node];
    }
    if (sourcePath.startsWith(node.path + '/')) {
      const selectedChildren = node.children ? selectRouteSubtree(node.children, sourcePath) : [];
      if (selectedChildren.length > 0) {
        return selectedChildren;
      }
    } else if (node.path.startsWith(sourcePath + '/')) {
      result.push(node);
    }
  }
  return result;
}
