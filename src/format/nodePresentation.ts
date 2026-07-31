import type { CoggitTreeNode } from '../core/types';
import { inspectNodeStatus, toRelativeUriPath } from '../core';
import { clipboardNodeStatusText, tooltipNodeStatusText } from './nodeFormat';

export function nodeTooltip(node: CoggitTreeNode): string {
  const cognitionRelPath = node.cognitionUri
    ? toRelativeUriPath(node.root.cognitionRootUri, node.cognitionUri)
    : null;
  const handbookId: 'leaf' | 'skeleton' | null = node.kind === 'file' ? 'leaf' : 'skeleton';
  const inspection = inspectNodeStatus({
    node,
    sourcePath: node.relativePath,
    cognitionPath: cognitionRelPath,
    handbookId,
  });
  return tooltipNodeStatusText(inspection);
}

export function nodeClipboardStatusText(node: CoggitTreeNode): string {
  const cognitionRelPath = node.cognitionUri
    ? toRelativeUriPath(node.root.cognitionRootUri, node.cognitionUri)
    : null;
  const handbookId: 'leaf' | 'skeleton' | null = node.kind === 'file' ? 'leaf' : 'skeleton';
  const inspection = inspectNodeStatus({
    node,
    sourcePath: node.relativePath,
    cognitionPath: cognitionRelPath,
    handbookId,
  });
  return clipboardNodeStatusText(inspection);
}
