import type { CoggitSnapshot, CoggitTreeNode, TreeProjectionNode } from './types.js';
import { toRelativeUriPath } from './mapping.js';

/**
 * Result of depth-limited tree projection.
 * Nodes beyond the requested depth are stripped; truncation flags report how many.
 */
export interface TreeDepthResult<T> {
  nodes: T[];
  truncated: boolean;
  omittedChildrenCount: number;
}

/**
 * Generic tree depth limiter.
 * Strips children beyond `depth` and reports truncation stats.
 * Works on any tree-like structure where nodes have an optional `children` array.
 */
export function applyTreeDepth<T extends { children?: T[]; truncated?: boolean; omittedChildrenCount?: number }>(
  nodes: T[],
  depth: number,
): TreeDepthResult<T> {
  let omittedChildrenCount = 0;

  const result = nodes.map((node) => {
    if (depth <= 0) {
      const nodeOmittedChildrenCount = node.children?.length ?? 0;
      omittedChildrenCount += nodeOmittedChildrenCount;
      const { children: _, ...rest } = node;
      return nodeOmittedChildrenCount > 0
        ? {
            ...rest,
            truncated: true,
            omittedChildrenCount: nodeOmittedChildrenCount,
          } as T
        : rest as T;
    }
    const childResult = node.children
      ? applyTreeDepth(node.children, depth - 1)
      : { nodes: [] as T[], truncated: false, omittedChildrenCount: 0 };
    omittedChildrenCount += childResult.omittedChildrenCount;
    return {
      ...node,
      children: childResult.nodes.length > 0 ? childResult.nodes : undefined,
    };
  });

  return {
    nodes: result,
    truncated: omittedChildrenCount > 0,
    omittedChildrenCount,
  };
}

export interface ProjectionOptions {
  depth?: number;
  scope?: 'tracked' | 'untracked' | 'issues' | 'all';
}

/**
 * Project a single Coggit tree node (and its descendants) into TreeProjectionNode[].
 * Applies depth limiting and scope filtering.
 */
export function projectTreeFromSnapshot(
  node: CoggitTreeNode,
  options: ProjectionOptions = {},
): TreeProjectionNode[] {
  const depth = options.depth ?? 2;
  const scope = options.scope ?? 'tracked';
  const result = renderProjectionNode(node, 0, { depth, scope });
  return result ? [result] : [];
}

/**
 * Project all roots of a Coggit snapshot into TreeProjectionNode[].
 * Applies depth limiting and scope filtering.
 */
export function projectSnapshotTree(
  snapshot: CoggitSnapshot,
  options: ProjectionOptions = {},
): TreeProjectionNode[] {
  const depth = options.depth ?? 2;
  const scope = options.scope ?? 'tracked';
  return snapshot.roots
    .map((root) => renderProjectionNode(root, 0, { depth, scope }))
    .filter((node): node is TreeProjectionNode => node !== undefined);
}

function renderProjectionNode(
  node: CoggitTreeNode,
  currentDepth: number,
  options: Required<ProjectionOptions>,
): TreeProjectionNode | undefined {
  const canRenderChildren = options.depth === undefined || currentDepth < options.depth;
  const renderedChildren = canRenderChildren
    ? (node.children ?? [])
      .map((child) => renderProjectionNode(child, currentDepth + 1, options))
      .filter((child): child is TreeProjectionNode => child !== undefined)
    : [];

  const matchesScope = nodeMatchesProjectionScope(node, options.scope);
  const containsScope = matchesScope || nodeContainsProjectionScope(node, options.scope);
  if (!containsScope && renderedChildren.length === 0) {
    return undefined;
  }

  const projectedNode: TreeProjectionNode = {
    path: node.relativePath,
    label: node.label,
    kind: node.kind,
    cognition: node.cognitionUri ? toRelativeCognitionPath(node) : undefined,
    description: node.description,
    observedStatus: node.status?.observedStatus ?? null,
    ownObservedStatus: node.ownStatus?.ownObservedStatus ?? null,
    tracked: node.ownStatus?.coverage?.ownCognition === 'present',
  };

  if (renderedChildren.length > 0) {
    projectedNode.children = renderedChildren;
  }

  return projectedNode;
}

function toRelativeCognitionPath(node: CoggitTreeNode): string {
  if (!node.cognitionUri || !node.root) { return ''; }
  try {
    return toRelativeUriPath(node.root.cognitionRootUri, node.cognitionUri);
  } catch {
    return node.cognitionUri.path;
  }
}

function nodeMatchesProjectionScope(node: CoggitTreeNode, scope: string): boolean {
  switch (scope) {
    case 'all':
      return true;
    case 'tracked':
      return node.ownStatus?.coverage?.ownCognition === 'present';
    case 'untracked':
      return node.ownStatus?.coverage?.ownCognition === 'missing'
        && node.ownStatus.coverage.isMaterializable === true;
    case 'issues':
      return (node.ownStatus?.issues?.length ?? 0) > 0;
    default:
      return false;
  }
}

function nodeContainsProjectionScope(node: CoggitTreeNode, scope: string): boolean {
  switch (scope) {
    case 'all':
      return true;
    case 'tracked':
      return (node.status?.coverage?.coveredCount ?? 0) > 0;
    case 'untracked':
      return (node.status?.coverage?.missingMaterializableCount ?? 0) > 0;
    case 'issues':
      return subtreeHasIssues(node);
    default:
      return false;
  }
}

function subtreeHasIssues(node: CoggitTreeNode): boolean {
  if ((node.ownStatus?.issues?.length ?? 0) > 0) {
    return true;
  }
  return (node.children ?? []).some((child) => subtreeHasIssues(child));
}
