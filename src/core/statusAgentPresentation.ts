import type { CoggitOperationAction } from './operationTypes';
import type {
  EvidenceDiagnostic,
  LocatedStatusIssue,
  NodeStatusInspection,
} from './statusTypes';
import { describeObservedStatus } from './status';

export type StatusAgentActionRole = 'recommended' | 'optional-on-demand' | 'diagnostic';
export type StatusAgentSeverityLevel = 'INFO' | 'WARN' | 'ERROR';

export interface StatusAgentIssueLegendEntry {
  level: StatusAgentSeverityLevel;
  tag: string;
  description: string;
  /** Label-only remediation action codes for this issue tag, rendered as `hint=`. */
  hints: string[];
}

export interface StatusAgentActionLegendEntry {
  tag: string;
  role: StatusAgentActionRole;
  description: string;
}

export interface StatusAgentIssueRow {
  level: StatusAgentSeverityLevel;
  issueTags: string[];
  sourcePath: string;
  actionTags: string[];
  optionalActionTags: string[];
}

export interface StatusAgentPresentation {
  sourcePath: string;
  cognitionPath: string | null;
  cognitionPresence: NodeStatusInspection['cognitionPresence'];
  status: NodeStatusInspection['status'];
  ownIssueCount: number;
  descendantIssueCount: number;
  ownIssues: StatusAgentIssueRow[];
  descendantIssues: StatusAgentIssueRow[];
  issueLegend: StatusAgentIssueLegendEntry[];
  actionLegend: StatusAgentActionLegendEntry[];
}

interface ProjectedAction {
  tag: string;
  role: StatusAgentActionRole;
  description: string;
}

const ISSUE_TAGS: Partial<Record<EvidenceDiagnostic['code'], { tag: string; description: string }>> = {
  'broken-links': {
    tag: 'broken-links',
    description: 'Cognition contains links that cannot be resolved.',
  },
  'conflicting-evidence': {
    tag: 'conflicting-evidence',
    description: 'Status evidence conflicts and needs review.',
  },
  'folder-structure-changed': {
    tag: 'stale-folder',
    description: 'Folder README is out of date with child structure.',
  },
  'folder-structure-outdated': {
    tag: 'stale-folder',
    description: 'Folder README is out of date with child structure.',
  },
  'metadata-broken': {
    tag: 'metadata-broken',
    description: 'Cognition metadata is missing or invalid.',
  },
  'missing-cognition': {
    tag: 'missing-cognition',
    description: 'Cognition is not created for this source.',
  },
  'missing-coverage': {
    tag: 'missing-coverage',
    description: 'Cognition coverage is incomplete.',
  },
  'outdated-cognition': {
    tag: 'stale-cognition',
    description: 'Cognition is out of date with source.',
  },
  'source-deleted': {
    tag: 'source-deleted',
    description: 'Cognition points at a source path that no longer exists.',
  },
  'template-cognition': {
    tag: 'template-cognition',
    description: 'Cognition still has template-like content.',
  },
};

export function projectStatusAgentPresentation(
  inspection: NodeStatusInspection,
): StatusAgentPresentation {
  const descendantActionsBySourcePath = new Map(
    inspection.triage
      .filter((entry) => entry.relation === 'descendant')
      .map((entry) => [entry.sourcePath, entry.actions] as const),
  );
  const ownActionsBySourcePath = new Map<string, readonly CoggitOperationAction[]>([
    [inspection.sourcePath, inspection.suggestedActions.filter(
      (action) => action.sourcePath === undefined || action.sourcePath === inspection.sourcePath,
    )],
  ]);

  const ownIssues = projectIssueRows(
    inspection.subtreeIssues.own,
    ownActionsBySourcePath,
  );
  const descendantIssues = projectIssueRows(
    inspection.subtreeIssues.descendant,
    descendantActionsBySourcePath,
  );
  const allActions = [
    ...inspection.suggestedActions,
    ...inspection.triage.flatMap((entry) => entry.actions),
  ];
  // Label-only remediation actions live in `suggestedActions` (own and
  // descendant issue labels merged by `inspectNodeStatus`), keyed by source
  // path and label. They render as issue-legend `hint=` tags. Attribution is by
  // label match so a hint lands on its specific issue tag — a sourcePath-level
  // join alone would smear one issue's hint across every issue of a
  // multi-issue source.
  const labelOnlyActionsBySourcePath = new Map<string, Map<string, CoggitOperationAction>>();
  for (const action of inspection.suggestedActions) {
    if (
      action.operation === undefined
      && action.handbookId === undefined
      && action.sourcePath !== undefined
    ) {
      let byLabel = labelOnlyActionsBySourcePath.get(action.sourcePath);
      if (byLabel === undefined) {
        byLabel = new Map();
        labelOnlyActionsBySourcePath.set(action.sourcePath, byLabel);
      }
      byLabel.set(action.label, action);
    }
  }

  return {
    sourcePath: inspection.sourcePath,
    cognitionPath: inspection.cognitionPath,
    cognitionPresence: inspection.cognitionPresence,
    status: inspection.status,
    ownIssueCount: inspection.issueSummary.own,
    descendantIssueCount: inspection.issueSummary.descendant,
    ownIssues,
    descendantIssues,
    issueLegend: uniqueIssueLegend([
      ...inspection.subtreeIssues.own,
      ...inspection.subtreeIssues.descendant,
    ], labelOnlyActionsBySourcePath),
    actionLegend: uniqueActionLegend(allActions, [...ownIssues, ...descendantIssues]),
  };
}

export function renderStatusAgentPresentation(view: StatusAgentPresentation): string {
  const lines: string[] = [];
  const statusLabel = describeObservedStatus(view.status ?? undefined);

  if (statusLabel) {
    lines.push(`Status: ${statusLabel}`);
  }
  lines.push(`Source: ${view.sourcePath}`);

  if (view.cognitionPresence === 'missing') {
    lines.push('Cognition: Not created (add on demand)');
  } else if (view.cognitionPresence === 'present' && view.cognitionPath !== null) {
    lines.push(`Cognition: ${view.cognitionPath}`);
  }

  if (view.issueLegend.length > 0) {
    lines.push('', 'Legend:', ...renderIssueLegend(view.issueLegend));
  }

  if (view.actionLegend.length > 0) {
    lines.push('', 'Actions:', ...renderActionLegend(view.actionLegend));
  }

  lines.push('', `Own issues: ${view.ownIssueCount}`);
  lines.push(...renderRows(view.ownIssues));
  lines.push('', `Descendant issues: ${view.descendantIssueCount}`);
  lines.push(...renderRows(view.descendantIssues));

  return lines.join('\n');
}

export function renderStatusAgentInspectionText(inspection: NodeStatusInspection): string {
  return renderStatusAgentPresentation(projectStatusAgentPresentation(inspection));
}

function projectIssueRows(
  issues: readonly LocatedStatusIssue[],
  actionsBySourcePath: ReadonlyMap<string, readonly CoggitOperationAction[]>,
): StatusAgentIssueRow[] {
  const rowsBySourcePath = new Map<string, {
    sourcePath: string;
    level: StatusAgentSeverityLevel;
    issueTags: string[];
  }>();

  for (const issue of issues) {
    const tag = issueTag(issue.issue.diagnostic).tag;
    const level = severityLevel(issue.issue.diagnostic.severity);
    const row = rowsBySourcePath.get(issue.relativePath);
    if (row) {
      row.level = highestSeverityLevel(row.level, level);
      if (!row.issueTags.includes(tag)) {
        row.issueTags.push(tag);
      }
    } else {
      rowsBySourcePath.set(issue.relativePath, {
        sourcePath: issue.relativePath,
        level,
        issueTags: [tag],
      });
    }
  }

  return Array.from(rowsBySourcePath.values()).map((row) => projectIssueRow(
    row,
    actionsBySourcePath.get(row.sourcePath) ?? [],
  ));
}

function projectIssueRow(
  row: Pick<StatusAgentIssueRow, 'level' | 'issueTags' | 'sourcePath'>,
  actions: readonly CoggitOperationAction[],
): StatusAgentIssueRow {
  const projectedActions = actions
    .map(projectAction)
    .filter((action): action is ProjectedAction => action !== null);

  return {
    ...row,
    actionTags: uniqueStrings(projectedActions
      .filter((action) => action.role === 'recommended')
      .map((action) => action.tag)),
    optionalActionTags: uniqueStrings(projectedActions
      .filter((action) => action.role === 'optional-on-demand')
      .map((action) => action.tag)),
  };
}

function uniqueIssueLegend(
  issues: readonly LocatedStatusIssue[],
  labelOnlyActionsBySourcePath: ReadonlyMap<string, ReadonlyMap<string, CoggitOperationAction>>,
): StatusAgentIssueLegendEntry[] {
  const seen = new Set<string>();
  const entries: StatusAgentIssueLegendEntry[] = [];

  for (const issue of issues) {
    const level = severityLevel(issue.issue.diagnostic.severity);
    const tag = issueTag(issue.issue.diagnostic);
    const hints = issueHintTags(issue, labelOnlyActionsBySourcePath);
    const key = `${level}\u0000${tag.tag}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    entries.push({ level, tag: tag.tag, description: tag.description, hints });
  }

  return entries;
}

/**
 * Label-only remediation codes for one issue, matched by label: the issue's own
 * `actions[].label` identifies the surviving label-only `CoggitOperationAction`
 * (structured actions were deduped out by `mergeSuggestedActions`, so their
 * labels find no entry here and correctly produce no hint).
 */
function issueHintTags(
  issue: LocatedStatusIssue,
  labelOnlyActionsBySourcePath: ReadonlyMap<string, ReadonlyMap<string, CoggitOperationAction>>,
): string[] {
  const byLabel = labelOnlyActionsBySourcePath.get(issue.relativePath);
  if (byLabel === undefined) {
    return [];
  }
  return uniqueStrings(
    issue.issue.actions
      .map((action) => byLabel.get(action.label))
      .filter((action): action is CoggitOperationAction => action !== undefined)
      .map((action) => action.code),
  );
}

function uniqueActionLegend(
  actions: readonly CoggitOperationAction[],
  rows: readonly StatusAgentIssueRow[],
): StatusAgentActionLegendEntry[] {
  const usedTags = new Set(rows.flatMap((row) => [
    ...row.actionTags,
    ...row.optionalActionTags,
  ]));
  const seen = new Set<string>();
  const entries: StatusAgentActionLegendEntry[] = [];

  for (const action of actions) {
    const projected = projectAction(action);
    if (!projected || !usedTags.has(projected.tag) || seen.has(projected.tag)) {
      continue;
    }
    seen.add(projected.tag);
    entries.push(projected);
  }

  return entries.sort((a, b) => actionTagOrder(a.tag) - actionTagOrder(b.tag));
}

function renderIssueLegend(entries: readonly StatusAgentIssueLegendEntry[]): string[] {
  const tagWidth = maxWidth(entries.map((entry) => entry.tag));
  return entries.map((entry) => {
    const hintText = entry.hints.length > 0 ? `  hint=${entry.hints.join(',')}` : '';
    return `${entry.level}  ${entry.tag.padEnd(tagWidth)}  ${entry.description}${hintText}`;
  });
}

function renderActionLegend(entries: readonly StatusAgentActionLegendEntry[]): string[] {
  const tagWidth = maxWidth(entries.map((entry) => entry.tag));
  return entries.map((entry) => `${entry.tag.padEnd(tagWidth)}  ${entry.description}`);
}

function renderRows(rows: readonly StatusAgentIssueRow[]): string[] {
  const issueWidth = maxWidth(rows.map((row) => row.issueTags.join(',')));
  const sourceWidth = maxWidth(rows.map((row) => row.sourcePath));
  return rows.map((row) => {
    const issueText = row.issueTags.join(',');
    const fields = [
      row.level,
      issueText.padEnd(issueWidth),
      `source=${row.sourcePath.padEnd(sourceWidth)}`,
    ];
    if (row.actionTags.length > 0) {
      fields.push(`actions=${row.actionTags.join(',')}`);
    }
    if (row.optionalActionTags.length > 0) {
      fields.push(`optional=${row.optionalActionTags.join(',')}`);
    }
    return fields.join(' | ');
  });
}

function projectAction(action: CoggitOperationAction): ProjectedAction | null {
  if (action.handbookId === 'leaf') {
    return {
      tag: 'sync-leaf',
      role: 'recommended',
      description: 'Read leaf handbook and sync cognition with source.',
    };
  }
  if (action.handbookId === 'skeleton') {
    return {
      tag: 'sync-skeleton',
      role: 'recommended',
      description: 'Read skeleton handbook and sync folder README.',
    };
  }

  switch (action.operation) {
    case 'add':
      return {
        tag: 'add',
        role: 'optional-on-demand',
        description: 'Optional materialization: create cognition only on demand.',
      };
    case 'resolve':
      return {
        tag: 'resolve',
        role: 'recommended',
        description: 'Accept the reviewed pair after sync.',
      };
    // Operation-backed diagnostic affordances (inspect/re-check). Reserved: the
    // status flow never synthesizes `routes`/`snapshot`/`status`, so these do
    // not currently reach a row or the issue legend.
    case 'routes':
      return {
        tag: 'routes',
        role: 'diagnostic',
        description: 'Inspect cognition routes for navigation.',
      };
    case 'snapshot':
      return {
        tag: 'snapshot',
        role: 'diagnostic',
        description: 'Inspect the CogGit tree snapshot.',
      };
    case 'status':
      return {
        tag: 'status',
        role: 'diagnostic',
        description: 'Inspect current status for this source.',
      };
    default:
      // Label-only remediation (no operation id, no handbook id) is a
      // diagnostic affordance: it renders as an issue-legend `hint=` tag (see
      // `uniqueIssueLegend`), not as an executable `actions=`/`optional=` row tag.
      return {
        tag: action.code,
        role: 'diagnostic',
        description: action.label,
      };
  }
}

function issueTag(diagnostic: EvidenceDiagnostic): { tag: string; description: string } {
  return ISSUE_TAGS[diagnostic.code] ?? {
    tag: diagnostic.code,
    description: diagnostic.message,
  };
}

function severityLevel(severity: EvidenceDiagnostic['severity']): StatusAgentSeverityLevel {
  switch (severity) {
    case 'error':
      return 'ERROR';
    case 'info':
      return 'INFO';
    case 'warning':
      return 'WARN';
  }
}

function highestSeverityLevel(
  left: StatusAgentSeverityLevel,
  right: StatusAgentSeverityLevel,
): StatusAgentSeverityLevel {
  return severityPriority(left) >= severityPriority(right) ? left : right;
}

function severityPriority(level: StatusAgentSeverityLevel): number {
  switch (level) {
    case 'ERROR':
      return 3;
    case 'WARN':
      return 2;
    case 'INFO':
      return 1;
  }
}

function maxWidth(values: readonly string[]): number {
  return values.reduce((max, value) => Math.max(max, value.length), 0);
}

function uniqueStrings(values: readonly string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}

function actionTagOrder(tag: string): number {
  const order: Record<string, number> = {
    'sync-leaf': 10,
    'sync-skeleton': 20,
    resolve: 30,
    add: 40,
    status: 50,
    snapshot: 60,
    routes: 70,
  };
  return order[tag] ?? 100;
}
