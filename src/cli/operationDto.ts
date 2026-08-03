import {
  renderPathMissText,
  type AddOperationResult,
  type ReviewUnchangedOperationResult,
  type SnapshotOperationResult,
  type StatusOperationResult,
} from '../core';
import {
  renderNodeSnapshotTreeText,
  renderNodeStatusInspectionText,
  renderSnapshotTreeText,
  type SnapshotTreeTextOptions,
} from '../render';
import { formatTimestamp } from '../core/time';

export { renderPathMissText };

export function renderStatusOperationResult(
  result: StatusOperationResult,
  mode: 'aggregate' | 'own' | 'subtree',
): string {
  // Use inspection-based rendering when available.
  if (result.inspection) {
    return renderNodeStatusInspectionText(result.inspection, mode);
  }

  // Fallback for not-found results (no node, no inspection).
  return renderPathMissText(result);
}

export function renderSnapshotOperationResult(
  result: SnapshotOperationResult,
  options: SnapshotTreeTextOptions,
): string {
  if (!result.found) {
    return renderPathMissText(result);
  }

  if (result.node) {
    return renderNodeSnapshotTreeText(result.node, withCliDefaultScope(options));
  }

  if (result.snapshot && hasSnapshotTreeOptions(options)) {
    return renderSnapshotTreeText(result.snapshot, withCliDefaultScope(options));
  }

  const projectLabels = result.projects.map((project) => project.label).join(', ') || '(none)';
  return [
    `Project: ${projectLabels}`,
    `Projects: ${result.projectCount}`,
    `Tracked: ${result.trackedCount}`,
    `Untracked: ${result.untrackedCount}`,
    `Issues: ${result.issueCount}`,
    `Next scopes: ${result.nextScopes.join(', ') || 'none'}`,
  ].join('\n');
}

export function renderAddOperationResult(result: AddOperationResult): string {
  if (!result.success) {
    if (result.error?.code === 'path-not-found') {
      return renderPathMissText(result);
    }
    return result.error?.message ?? 'Add operation failed.';
  }

  const action = result.created ? 'Created' : 'Already exists';
  return `${action} ${result.kind} cognition: ${result.cognitionPath}`;
}

export function renderReviewUnchangedOperationResult(result: ReviewUnchangedOperationResult): string {
  if (!result.success) {
    if (result.error?.code === 'path-not-found') {
      return renderPathMissText(result);
    }
    return [
      `Review unchanged failed for ${result.sourcePath}: ${result.error?.message ?? 'Unknown error'}`,
      `Next: verify current status with ${result.verify.tool} for ${result.verify.sourcePath}.`,
    ].join('\n');
  }

  return [
    'Reviewed unchanged: yes',
    `Source path: ${result.sourcePath}`,
    `Cognition path: ${result.cognitionPath ?? 'none'}`,
    `Registry key: ${result.sourceKey ?? 'none'}`,
    `Verification time: ${formatTimestamp(result.verificationTimeMs, 'none')}`,
    `Next: verify current status with ${result.verify.tool} for ${result.verify.sourcePath}.`,
  ].join('\n');
}

function hasSnapshotTreeOptions(options: SnapshotTreeTextOptions): boolean {
  return options.scope !== undefined || options.maxDepth !== undefined;
}

function withCliDefaultScope(options: SnapshotTreeTextOptions): SnapshotTreeTextOptions {
  return { ...options, scope: options.scope ?? 'tracked' };
}
