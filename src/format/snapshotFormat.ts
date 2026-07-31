import type { CoggitSnapshot, CoggitTreeNode } from '../core/types';
import { describeObservedStatus } from '../core';
import { formatFileList } from './structFormat.js';

export type SnapshotScope = 'tracked' | 'untracked' | 'all' | 'issues';

export interface SnapshotTreeTextOptions {
  scope?: SnapshotScope;
  maxDepth?: number;
}

// ── Snapshot tree (indented hierarchy) ──────────────────────────────────────
// Delegates to structFormat for standardized agent-facing output.

export function snapshotTreeText(
  snapshot: CoggitSnapshot,
  options: SnapshotTreeTextOptions = {},
): string {
  const treeOptions = normalizeOptions(options);
  const lines = snapshot.roots
    .map((root) => renderScopedTreeNode(root, 0, treeOptions))
    .filter((line): line is string => line !== undefined);
  return lines.length > 0 ? lines.join('\n') : emptySnapshotText(treeOptions.scope);
}

export function nodeSnapshotTreeText(
  node: CoggitTreeNode,
  options: SnapshotTreeTextOptions = {},
): string {
  const treeOptions = normalizeOptions(options);
  const rendered = renderScopedTreeNode(node, 0, treeOptions);
  return rendered ?? emptySnapshotText(treeOptions.scope);
}

// ── File list (count + paths) ───────────────────────────────────────────────

export function listText(
  nodes: CoggitTreeNode[],
  tag: string,
): string {
  return formatFileList(nodes, tag);
}

interface NormalizedSnapshotTreeTextOptions {
  scope: SnapshotScope;
  maxDepth?: number;
}

function normalizeOptions(options: SnapshotTreeTextOptions): NormalizedSnapshotTreeTextOptions {
  const maxDepth = options.maxDepth;
  const normalizedMaxDepth =
    maxDepth !== undefined && Number.isInteger(maxDepth) && maxDepth >= 0
      ? maxDepth
      : undefined;
  return {
    scope: options.scope ?? 'tracked',
    maxDepth: normalizedMaxDepth,
  };
}

function renderScopedTreeNode(
  node: CoggitTreeNode,
  depth: number,
  options: NormalizedSnapshotTreeTextOptions,
): string | undefined {
  if (options.maxDepth !== undefined && depth > options.maxDepth) {
    return undefined;
  }

  const canRenderChildren = options.maxDepth === undefined || depth < options.maxDepth;
  const renderedChildren = canRenderChildren
    ? (node.children ?? [])
      .map((child) => renderScopedTreeNode(child, depth + 1, options))
      .filter((line): line is string => line !== undefined)
    : [];

  const matchesScope = nodeMatchesOwnScope(node, options.scope);
  const containsScope = matchesScope || nodeContainsScope(node, options.scope);
  if (!containsScope && renderedChildren.length === 0) {
    return undefined;
  }

  const indent = '  '.repeat(depth);
  const lines = [`${indent}${node.label} [${scopedNodeSnapshotLabel(node, options.scope, matchesScope, containsScope)}]`];
  lines.push(...renderedChildren);
  return lines.join('\n');
}

function nodeMatchesOwnScope(node: CoggitTreeNode, scope: SnapshotScope): boolean {
  switch (scope) {
    case 'all':
      return true;
    case 'tracked':
      return node.ownStatus?.coverage?.ownCognition === 'present';
    case 'untracked':
      return node.ownStatus?.coverage?.ownCognition === 'missing'
        && node.ownStatus.coverage.isMaterializable;
    case 'issues':
      return (node.ownStatus?.issues?.length ?? 0) > 0;
  }
}

function nodeContainsScope(node: CoggitTreeNode, scope: SnapshotScope): boolean {
  switch (scope) {
    case 'all':
      return true;
    case 'tracked':
      return (node.status?.coverage?.coveredCount ?? 0) > 0;
    case 'untracked':
      return (node.status?.coverage?.missingMaterializableCount ?? 0) > 0;
    case 'issues':
      return subtreeHasIssues(node);
  }
}

function subtreeHasIssues(node: CoggitTreeNode): boolean {
  if ((node.ownStatus?.issues?.length ?? 0) > 0) {
    return true;
  }

  return (node.children ?? []).some((child) => subtreeHasIssues(child));
}

function nodeSnapshotLabel(node: CoggitTreeNode): string {
  const status = describeObservedStatus(node.status?.observedStatus);
  if (status) {
    return status;
  }

  if (node.ownStatus?.coverage?.ownCognition === 'missing') {
    return 'Untracked';
  }

  return 'Unknown';
}

function scopedNodeSnapshotLabel(
  node: CoggitTreeNode,
  scope: SnapshotScope,
  matchesScope: boolean,
  containsScope: boolean,
): string {
  if (scope === 'untracked' && matchesScope) {
    return 'Untracked';
  }

  if (matchesScope || scope === 'all') {
    return nodeSnapshotLabel(node);
  }

  if (containsScope) {
    switch (scope) {
      case 'tracked':
        return nodeSnapshotLabel(node);
      case 'untracked':
        return 'Contains untracked';
      case 'issues':
        return 'Contains issues';
    }
  }

  switch (scope) {
    case 'tracked':
      return nodeSnapshotLabel(node);
    case 'untracked':
      return 'Contains untracked';
    case 'issues':
      return 'Contains issues';
  }
}

function emptySnapshotText(scope: SnapshotScope): string {
  switch (scope) {
    case 'tracked':
      return 'No tracked cognition nodes found. Use scope="untracked" to inspect source nodes missing paired cognition.';
    case 'untracked':
      return 'No untracked materializable source nodes found.';
    case 'issues':
      return 'No cognition maintenance issues found.';
    case 'all':
      return 'No matching nodes found.';
  }
}
