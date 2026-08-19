import {
  renderPathMissText,
  type AddOperationResult,
  type CoggitOperationAction,
  type NodeStatusTriageEntry,
  type ResolveOperationResult,
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
): string {
  // Use inspection-based rendering when available.
  if (result.inspection) {
    const sections = [renderNodeStatusInspectionText(result.inspection)];
    const actions = renderOperationActions(result.inspection.suggestedActions);
    if (actions) {
      sections.push(actions);
    }
    const triage = renderTriageEntries(result.inspection.triage);
    if (triage) {
      sections.push(triage);
    }
    return sections.join('\n\n');
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
    return [
      result.error?.message ?? 'Add operation failed.',
      `Next: verify current status with ${recheckCommandText(result.suggestedActions)}.`,
    ].join('\n');
  }

  const action = result.created ? 'Created' : 'Already exists';
  return `${action} ${result.kind} cognition: ${result.cognitionPath}`;
}

export function renderResolveOperationResult(result: ResolveOperationResult): string {
  if (!result.success) {
    if (result.error?.code === 'path-not-found') {
      return renderPathMissText(result);
    }
    return [
      `Resolve failed for ${result.sourcePath}: ${result.error?.message ?? 'Unknown error'}`,
      `Next: verify current status with ${recheckCommandText(result.suggestedActions)}.`,
    ].join('\n');
  }

  return [
    'Resolved: yes',
    `Source path: ${result.sourcePath}`,
    `Cognition path: ${result.cognitionPath ?? 'none'}`,
    `Registry key: ${result.sourceKey ?? 'none'}`,
    `Verification time: ${formatTimestamp(result.verificationTimeMs, 'none')}`,
  ].join('\n');
}

/** CLI surface addressing for the emitted re-check action: `coggit <operation> <sourcePath>`. */
function recheckCommandText(actions: readonly CoggitOperationAction[]): string {
  for (const action of actions) {
    if (action.operation === 'status' && action.sourcePath) {
      return `coggit ${action.operation} ${action.sourcePath}`;
    }
  }
  return '';
}

/**
 * CLI surface addressing for status's structured next steps: operation
 * actions render as `coggit <operation> [sourcePath]`, handbook-bearing
 * authoring actions as the real `coggit handbook <kind>` subcommand.
 */
function renderOperationActionLine(action: CoggitOperationAction): string | null {
  if (action.operation !== undefined) {
    const command = `coggit ${action.operation}${action.sourcePath ? ` ${action.sourcePath}` : ''}`;
    return `- ${command}: ${action.label}`;
  }
  if (action.handbookId !== undefined) {
    return `- coggit handbook ${action.handbookId}: ${action.label}`;
  }
  return null;
}

function renderOperationActions(actions: readonly CoggitOperationAction[]): string {
  const lines = actions
    .map(renderOperationActionLine)
    .filter((line): line is string => line !== null);
  return lines.length > 0 ? `Suggested actions:\n${lines.join('\n')}` : '';
}

/**
 * CLI rendering of the subtree triage channel: per-descendant maintenance
 * steps grouped by issue-bearing node. The own entry is facts-only by
 * contract, so only descendant entries render action lines here; the inspected
 * node's next steps stay in the `Suggested actions:` block. Entries without
 * mappable actions are omitted (their issues are already in the presentation).
 */
function renderTriageEntries(triage: readonly NodeStatusTriageEntry[]): string {
  const blocks: string[] = [];
  for (const entry of triage) {
    const lines = entry.actions
      .map(renderOperationActionLine)
      .filter((line): line is string => line !== null);
    if (lines.length === 0) {
      continue;
    }
    blocks.push([
      `- ${entry.sourcePath} (${entry.relation}):`,
      ...lines.map((line) => `  ${line}`),
    ].join('\n'));
  }
  return blocks.length > 0 ? `Subtree triage:\n${blocks.join('\n')}` : '';
}

function hasSnapshotTreeOptions(options: SnapshotTreeTextOptions): boolean {
  return options.scope !== undefined || options.maxDepth !== undefined;
}

function withCliDefaultScope(options: SnapshotTreeTextOptions): SnapshotTreeTextOptions {
  return { ...options, scope: options.scope ?? 'tracked' };
}
