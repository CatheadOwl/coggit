import type {
  CognitionCoveragePresence,
  NodeStatusInspection,
  ObservedStatus,
  SubtreeIssueQueryResult,
} from './statusTypes';
import { describeObservedStatus } from './status';

export type StatusPresentationMode = 'aggregate' | 'own' | 'subtree';
export type StatusPresentationFormat = 'text' | 'markdown';

export interface StatusPresentationIssue {
  sourcePath: string;
  cognitionPath: string | null;
  severity: 'info' | 'warning' | 'error';
  message: string;
  suggestedActions: string[];
}

export interface StatusPresentationView {
  sourcePath: string;
  cognitionPath: string | null;
  cognitionPresence: CognitionCoveragePresence;
  scope: 'own' | 'subtree';
  status: ObservedStatus | null;
  ownStatus: ObservedStatus | null;
  descendantStatus: ObservedStatus | null;
  ownIssues: StatusPresentationIssue[];
  descendantIssues: StatusPresentationIssue[];
}

function presentationPresence(inspection: NodeStatusInspection): CognitionCoveragePresence {
  return inspection.cognitionPresence
    ?? (inspection.cognitionPath !== null ? 'present' : 'not-applicable');
}

function mapIssues(
  issues: SubtreeIssueQueryResult['ownIssues'],
): StatusPresentationIssue[] {
  return issues.map((located) => ({
    sourcePath: located.relativePath,
    cognitionPath: located.cognitionPath ?? null,
    severity: located.issue.diagnostic.severity,
    message: located.issue.diagnostic.message,
    suggestedActions: located.issue.actions.map((action) => action.label),
  }));
}

export function projectStatusPresentation(
  inspection: NodeStatusInspection,
  mode: StatusPresentationMode = 'aggregate',
): StatusPresentationView {
  const ownIssues = mapIssues(inspection.subtreeIssues.own);
  const descendantIssues = mode === 'own'
    ? []
    : mapIssues(inspection.subtreeIssues.descendant);

  return {
    sourcePath: inspection.sourcePath,
    cognitionPath: inspection.cognitionPath,
    cognitionPresence: presentationPresence(inspection),
    scope: mode === 'own' ? 'own' : 'subtree',
    status: mode === 'own' ? inspection.ownStatus : inspection.status,
    ownStatus: inspection.ownStatus,
    descendantStatus: inspection.descendantStatus,
    ownIssues,
    descendantIssues,
  };
}

function appendIssueLines(
  lines: string[],
  issues: readonly StatusPresentationIssue[],
): void {
  for (const issue of issues) {
    const actionText = issue.suggestedActions.length > 0
      ? ` Suggested actions: ${issue.suggestedActions.join('; ')}.`
      : '';
    const line = `- ${issue.sourcePath}: [${issue.severity}] ${issue.message}${actionText}`;
    lines.push(line);
  }
}

export function renderStatusPresentation(
  view: StatusPresentationView,
  format: StatusPresentationFormat = 'text',
): string {
  const markdown = format === 'markdown';
  const lineBreak = markdown ? '  \n' : '\n';
  const label = (value: string) => markdown ? `**${value}**` : value;
  const lines: string[] = [];
  const statusLabel = describeObservedStatus(view.status ?? undefined);

  if (statusLabel) {
    lines.push(`${label('Status')}: ${statusLabel}`);
  }
  lines.push(`${label('Source')}: ${view.sourcePath}`);

  if (view.cognitionPresence === 'missing') {
    lines.push(`${label('Cognition')}: Not created (add on demand)`);
  } else if (view.cognitionPresence === 'present' && view.cognitionPath !== null) {
    lines.push(`${label('Cognition')}: ${view.cognitionPath}`);
  }

  lines.push('', `${label('Own issues')}: ${view.ownIssues.length}`);
  appendIssueLines(lines, view.ownIssues);

  if (view.scope === 'subtree') {
    lines.push('', `${label('Descendant issues')}: ${view.descendantIssues.length}`);
    appendIssueLines(lines, view.descendantIssues);
  }

  return lines.join(lineBreak);
}
