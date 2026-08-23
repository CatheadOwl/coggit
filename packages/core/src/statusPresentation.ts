import type {
  CognitionCoveragePresence,
  LocatedStatusIssue,
  NodeStatusInspection,
  ObservedStatus,
} from './statusTypes';
import { describeObservedStatus } from './status';

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
  status: ObservedStatus | null;
  ownStatus: ObservedStatus | null;
  descendantStatus: ObservedStatus | null;
  ownIssues: StatusPresentationIssue[];
  descendantIssues: StatusPresentationIssue[];
}

/** Map located issues into the serializable presentation issue shape. Shared
 *  by the single-node presentation view and the subtree triage projection so
 *  both keep the same null encoding and field conventions. */
export function mapStatusPresentationIssues(
  issues: readonly LocatedStatusIssue[],
): StatusPresentationIssue[] {
  return issues.map((located) => ({
    sourcePath: located.relativePath,
    cognitionPath: located.cognitionPath,
    severity: located.issue.diagnostic.severity,
    message: located.issue.diagnostic.message,
    suggestedActions: located.issue.actions.map((action) => action.label),
  }));
}

export function projectStatusPresentation(
  inspection: NodeStatusInspection,
): StatusPresentationView {
  const ownIssues = mapStatusPresentationIssues(inspection.subtreeIssues.own);
  const descendantIssues = mapStatusPresentationIssues(inspection.subtreeIssues.descendant);

  return {
    sourcePath: inspection.sourcePath,
    cognitionPath: inspection.cognitionPath,
    cognitionPresence: inspection.cognitionPresence,
    status: inspection.status,
    ownStatus: inspection.ownStatus,
    descendantStatus: inspection.descendantStatus,
    ownIssues,
    descendantIssues,
  };
}

/** Adapter-ready structured view for a status miss: the requested source path
 *  plus recovery guidance (`pathHints`, miss/hint messages). Complements
 *  `StatusPresentationView` (the inspection-backed HIT view). */
export interface StatusMissPresentation {
  sourcePath: string;
  pathHints: string[];
  pathMissMessage?: string;
  pathHintMessage?: string;
}

/** Project a status miss into an adapter-ready structured view. A miss has no
 *  inspection, so this carries the lookup identity and recovery guidance without
 *  requiring each adapter to assemble its own fallback shape. */
export function projectStatusMissPresentation(result: {
  sourcePath: string;
  pathHints: readonly string[];
  pathMissMessage?: string;
  pathHintMessage?: string;
}): StatusMissPresentation {
  return {
    sourcePath: result.sourcePath,
    pathHints: [...result.pathHints],
    ...(result.pathMissMessage ? { pathMissMessage: result.pathMissMessage } : {}),
    ...(result.pathHintMessage ? { pathHintMessage: result.pathHintMessage } : {}),
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

  lines.push('', `${label('Descendant issues')}: ${view.descendantIssues.length}`);
  appendIssueLines(lines, view.descendantIssues);

  return lines.join(lineBreak);
}
