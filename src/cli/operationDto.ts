import {
  describeObservedStatus,
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

export function renderStatusOperationResult(
  result: StatusOperationResult,
  mode: 'aggregate' | 'own' | 'subtree',
): string {
  // Use inspection-based rendering when available.
  if (result.inspection) {
    return renderNodeStatusInspectionText(result.inspection, mode);
  }

  // Fallback for not-found results (no node, no inspection).
  const lines = [`Source: ${result.sourcePath}`];
  if (result.cognitionPath) {
    lines.push(`Cognition: ${result.cognitionPath}`);
  }

  if (mode === 'subtree') {
    lines.push(`Status: ${renderObservedStatus(result.status)}`);
    lines.push(`Own issues: ${result.ownIssueCount}`);
    lines.push(`Descendant issues: ${result.descendantIssueCount}`);
    appendOperationIssues(lines, '\nIssues:', result.issues);
    appendSuggestedActions(lines, result.suggestedActions);
    return lines.join('\n');
  }

  lines.push(`Status: ${renderObservedStatus(mode === 'own' ? result.ownStatus : result.status)}`);
  lines.push(`Own status: ${renderObservedStatus(result.ownStatus)}`);
  lines.push(`Descendant status: ${renderObservedStatus(result.descendantStatus)}`);
  lines.push(`Issues: ${mode === 'own' ? result.ownIssueCount : result.issueCount}`);
  appendOperationIssues(lines, undefined, mode === 'own'
    ? result.issues.filter((issue) => issue.relativePath === result.sourcePath)
    : result.issues);
  appendSuggestedActions(lines, result.suggestedActions);
  return lines.join('\n');
}

export function renderSnapshotOperationResult(
  result: SnapshotOperationResult,
  options: SnapshotTreeTextOptions,
): string {
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
    return result.error?.message ?? 'Add operation failed.';
  }

  const action = result.created ? 'Created' : 'Already exists';
  return `${action} ${result.kind} cognition: ${result.cognitionPath}`;
}

export function renderReviewUnchangedOperationResult(result: ReviewUnchangedOperationResult): string {
  if (!result.success) {
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

function appendOperationIssues(
  lines: string[],
  heading: string | undefined,
  issues: StatusOperationResult['issues'],
): void {
  if (issues.length === 0) {
    return;
  }

  if (heading) {
    lines.push(heading);
  }
  for (const issue of issues) {
    lines.push(`- ${issue.relativePath}: [${issue.severity}] ${issue.message}`);
  }
}

function appendSuggestedActions(
  lines: string[],
  actions: StatusOperationResult['suggestedActions'],
): void {
  if (actions.length === 0) {
    return;
  }

  lines.push('\nSuggested actions:');
  for (const action of actions) {
    lines.push(`- ${action.label}`);
  }
}

function renderObservedStatus(status: StatusOperationResult['status']): string {
  return describeObservedStatus(status ?? undefined)?.toLowerCase() ?? 'none';
}

function hasSnapshotTreeOptions(options: SnapshotTreeTextOptions): boolean {
  return options.scope !== undefined || options.maxDepth !== undefined;
}

function withCliDefaultScope(options: SnapshotTreeTextOptions): SnapshotTreeTextOptions {
  return { ...options, scope: options.scope ?? 'tracked' };
}
