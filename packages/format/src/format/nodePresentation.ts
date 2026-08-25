import type { CoggitTreeNode } from '@coggit/core';
import { inspectNodeStatus, toRelativeUriPath } from '@coggit/core';
import { clipboardNodeStatusText, tooltipNodeStatusText } from './nodeFormat';

function projectRelativeSourcePath(node: CoggitTreeNode): string {
  return toRelativeUriPath(node.root.projectRootUri, node.sourceUri);
}

function projectRelativeCognitionPath(node: CoggitTreeNode): string | null {
  return node.cognitionUri
    ? toRelativeUriPath(node.root.projectRootUri, node.cognitionUri)
    : null;
}

export function nodeTooltip(node: CoggitTreeNode): string {
  const handbookId: 'leaf' | 'skeleton' | null = node.kind === 'file' ? 'leaf' : 'skeleton';
  const inspection = inspectNodeStatus({
    node,
    sourcePath: projectRelativeSourcePath(node),
    cognitionPath: projectRelativeCognitionPath(node),
    handbookId,
  });
  return tooltipNodeStatusText(inspection);
}

export function nodeClipboardStatusText(node: CoggitTreeNode): string {
  const handbookId: 'leaf' | 'skeleton' | null = node.kind === 'file' ? 'leaf' : 'skeleton';
  const inspection = inspectNodeStatus({
    node,
    sourcePath: projectRelativeSourcePath(node),
    cognitionPath: projectRelativeCognitionPath(node),
    handbookId,
  });
  return clipboardNodeStatusText(inspection);
}
