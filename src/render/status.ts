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
  if (inspection.cognitionPath) {
    lines.push(`Cognition: ${inspection.cognitionPath}`);
  }

  if (mode === 'subtree') {
    lines.push(`Status: ${renderStatusText(inspection.status ?? undefined)}`);
    lines.push(`Own issues: ${inspection.issueSummary.own}`);
    lines.push(`Descendant issues: ${inspection.issueSummary.descendant}`);
    appendInspectionIssues(lines, '\nIssues:', inspection.subtreeIssues, mode);
    appendInspectionActions(lines, inspection.suggestedActions);
    return lines.join('\n');
  }

  lines.push(`Status: ${renderStatusText((mode === 'own' ? inspection.ownStatus : inspection.status) ?? undefined)}`);
  lines.push(`Own status: ${renderStatusText(inspection.ownStatus ?? undefined)}`);
  lines.push(`Descendant status: ${renderStatusText(inspection.descendantStatus ?? undefined)}`);
  lines.push(`Issues: ${mode === 'own' ? inspection.issueSummary.own : inspection.issueSummary.total}`);
  appendInspectionIssues(lines, undefined, inspection.subtreeIssues, mode);
  appendInspectionActions(lines, inspection.suggestedActions);
  return lines.join('\n');
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function renderLocatedIssueText(located: SubtreeIssueQueryResult['ownIssues'][number]): string {
  const diagnostic = located.issue.diagnostic;
  return `- ${located.relativePath}: [${diagnostic.severity}] ${diagnostic.message}`;
}

function appendInspectionIssues(
  lines: string[],
  heading: string | undefined,
  issues: NodeStatusInspection['subtreeIssues'],
  mode: 'aggregate' | 'own' | 'subtree',
): void {
  if (mode === 'own') {
    if (issues.own.length === 0) {
      return;
    }
    if (heading) {
      lines.push(heading);
    }
    for (const located of issues.own) {
      lines.push(renderLocatedIssueText(located));
    }
    return;
  }

  // aggregate or subtree: show own + descendant
  const allIssues = [...issues.own, ...issues.descendant];
  if (allIssues.length === 0) {
    return;
  }

  if (heading) {
    lines.push(heading);
  }
  for (const located of allIssues) {
    lines.push(renderLocatedIssueText(located));
  }
}

function appendInspectionActions(
  lines: string[],
  actions: NodeStatusInspection['suggestedActions'],
): void {
  if (actions.length === 0) {
    return;
  }

  lines.push('\nSuggested actions:');
  for (const action of actions) {
    lines.push(`- ${action.label}`);
  }
}

function renderStatusText(status: Parameters<typeof import('../core/status').describeObservedStatus>[0]): string {
  return describeObservedStatus(status)?.toLowerCase() ?? 'none';
}
