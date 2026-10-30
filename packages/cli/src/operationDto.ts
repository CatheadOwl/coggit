import {
  renderPathMissText,
  type AddOperationResult,
  type CoggitOperationAction,
  type ResolveOperationResult,
  projectStatusAgentPresentation,
  type StatusAgentPresentation,
  renderStatusAgentPresentation,
  type SnapshotOperationResult,
  type StatusOperationResult,
} from '@coggit/core';
import {
  nodeSnapshotTreeText,
  snapshotTreeText,
  type SnapshotTreeTextOptions,
} from '@coggit/format';
import { formatTimestamp } from '@coggit/core/internal';

export { renderPathMissText };

export function renderStatusOperationResult(
  result: StatusOperationResult,
): string {
  // Use inspection-based rendering when available.
  if (result.inspection) {
    return renderStatusAgentPresentation(withCliHandbookAddressing(
      projectStatusAgentPresentation(result.inspection),
    ));
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
    return nodeSnapshotTreeText(result.node, withCliDefaultScope(options));
  }

  if (result.snapshot && hasSnapshotTreeOptions(options)) {
    return snapshotTreeText(result.snapshot, withCliDefaultScope(options));
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
  const lines = [`${action} ${result.kind} cognition: ${result.cognitionPath}`];
  // The CLI spelling of the add surface's handbook hint (MCP emits the same
  // guidance as the `coggit://handbook/<kind>` resource): the freshly created
  // document is template material — the handbook says what to write into it.
  if (result.handbookId) {
    lines.push(
      `Next: read coggit handbook ${result.handbookId}, then complete the paired cognition document with design intent/contracts/boundaries rather than implementation summaries.`,
    );
  }
  return lines.join('\n');
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
 * CLI surface addressing for handbook-bearing actions: core's action legend
 * describes the remediation ("Read leaf handbook…") with zero surface
 * spellings; the CLI names the command that prints the handbook — the same
 * re-voicing seam as `recheckCommandText` and the MCP `resource_link`.
 */
const CLI_ACTION_DESCRIPTIONS: Readonly<Record<string, string>> = {
  'sync-leaf':
    'Read the leaf handbook (coggit handbook leaf) and sync cognition with source.',
  'sync-skeleton':
    'Read the skeleton handbook (coggit handbook skeleton) and sync folder README.',
};

function withCliHandbookAddressing(
  presentation: StatusAgentPresentation,
): StatusAgentPresentation {
  return {
    ...presentation,
    actionLegend: presentation.actionLegend.map((entry) => ({
      ...entry,
      description: CLI_ACTION_DESCRIPTIONS[entry.tag] ?? entry.description,
    })),
  };
}

function hasSnapshotTreeOptions(options: SnapshotTreeTextOptions): boolean {
  return options.scope !== undefined || options.maxDepth !== undefined;
}

function withCliDefaultScope(options: SnapshotTreeTextOptions): SnapshotTreeTextOptions {
  return { ...options, scope: options.scope ?? 'tracked' };
}
