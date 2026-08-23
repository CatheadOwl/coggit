import type { CoggitSnapshot, CoggitTreeNode } from '@coggit/core';
import { nodeSnapshotTreeText, snapshotTreeText, type SnapshotScope, type SnapshotTreeTextOptions } from '../format/snapshotFormat';

export type { SnapshotScope } from '../format/snapshotFormat';
export type { SnapshotTreeTextOptions } from '../format/snapshotFormat';

export function renderSnapshotTreeText(
  snapshot: CoggitSnapshot,
  options: SnapshotTreeTextOptions = {},
): string {
  return snapshotTreeText(snapshot, options);
}

export function renderNodeSnapshotTreeText(
  node: CoggitTreeNode,
  options: SnapshotTreeTextOptions = {},
): string {
  return nodeSnapshotTreeText(node, options);
}
