import type {
  NodeStatusInspection,
  SubtreeIssueQueryResult,
} from '../core/types';
import { describeObservedStatus } from '../core';

export function renderStatusSectionsText(sections: readonly string[]): string {
  return sections.join('\n\n');
}

// ─── Inspection-based CLI rendering ─────────────────────────────────────────

export function renderNodeStatusInspectionText(
  inspection: NodeStatusInspection,
  mode: 'aggregate' | 'own' | 'subtree',
): string {
  const lines = [`Source: ${inspection.sourcePath}`];
  if (inspection.cognitionPresence === 'missing') {
    lines.push('Cognition: Not created (add on demand)');
  } else if (inspection.cognitionPath && inspection.cognitionPresence !== 'not-applicable') {
    lines.push(`Cognition: ${inspection.cognitionPath}`);
  }

  if (mode === 'subtree') {
    lines.push(`Status: ${renderStatusText(inspection.status ?? undefined)}`);
    appendInspectionIssueSections(lines, inspection, mode);
    return lines.join('\n');
  }

  lines.push(`Status: ${renderStatusText((mode === 'own' ? inspection.ownStatus : inspection.status) ?? undefined)}`);
  lines.push(`Own status: ${renderStatusText(inspection.ownStatus ?? undefined)}`);
  lines.push(`Descendant status: ${renderStatusText(inspection.descendantStatus ?? undefined)}`);
  lines.push(`Issues: ${mode === 'own' ? inspection.issueSummary.own : inspection.issueSummary.total}`);
  appendInspectionIssueSections(lines, inspection, mode);
  return lines.join('\n');
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function renderLocatedIssueText(located: SubtreeIssueQueryResult['ownIssues'][number]): string {
  const diagnostic = located.issue.diagnostic;
  const actions = located.issue.actions.map((action) => action.label);
  const actionText = actions.length > 0
    ? ` Suggested actions: ${actions.join('; ')}.`
    : '';
  return `- ${located.relativePath}: [${diagnostic.severity}] ${diagnostic.message}${actionText}`;
}

function appendInspectionIssueSections(
  lines: string[],
  inspection: NodeStatusInspection,
  mode: 'aggregate' | 'own' | 'subtree',
): void {
  if (mode === 'own') {
    const issues = inspection.subtreeIssues;
    if (issues.own.length === 0) {
      return;
    }
    for (const located of issues.own) {
      lines.push(renderLocatedIssueText(located));
    }
    return;
  }

  const issues = inspection.subtreeIssues;
  lines.push('', `Own issues: ${inspection.issueSummary.own}`);
  if (issues.own.length > 0) {
    for (const located of issues.own) {
      lines.push(renderLocatedIssueText(located));
    }
  }

  lines.push('', `Descendant issues: ${inspection.issueSummary.descendant}`);
  if (issues.descendant.length > 0) {
    for (const located of issues.descendant) {
      lines.push(renderLocatedIssueText(located));
    }
  }
}

function renderStatusText(status: Parameters<typeof import('../core/status').describeObservedStatus>[0]): string {
  return describeObservedStatus(status)?.toLowerCase() ?? 'none';
}
