import { z } from 'zod';

import {
  projectStatusMissPresentation,
  projectStatusPresentation,
  type StatusOperationResult,
  type StatusPresentationView,
} from '../../core/index.js';
import {
  createHandbookMaintenanceAction,
  handbookUri,
  mcpMaintenanceNextActionSchema,
  mcpStatusIssueSchema,
  observedStatusSchema,
  operationActionSchema,
  toMcpOperationAction,
} from './shared.js';

export const statusOperationOutputSchema = {
  sourcePath: z.string(),
  cognitionPath: z.string().nullable(),
  cognitionPresence: z.enum(['present', 'missing', 'not-applicable']),
  status: observedStatusSchema,
  ownStatus: observedStatusSchema,
  descendantStatus: observedStatusSchema,
  ownIssues: z.array(mcpStatusIssueSchema),
  descendantIssues: z.array(mcpStatusIssueSchema),
  handbookUri: z.string().nullable(),
  nextActions: z.array(mcpMaintenanceNextActionSchema),
  suggestedActions: z.array(operationActionSchema),
  pathHints: z.array(z.string()),
  pathMissMessage: z.string().optional(),
  pathHintMessage: z.string().optional(),
};

export interface MaintenanceNextAction {
  code: string;
  label: string;
  kind: 'read-resource' | 'read-cognition';
  priority: number;
  resourceUri?: string;
  cognitionPath?: string;
}

export interface StatusMcpView extends StatusPresentationView {
  [key: string]: unknown;
  handbookUri: string | null;
  nextActions: MaintenanceNextAction[];
  suggestedActions: Array<z.infer<typeof operationActionSchema>>;
  pathHints: string[];
  pathMissMessage?: string;
  pathHintMessage?: string;
}

function statusNextActions(input: {
  handbookUri: string | null;
}): MaintenanceNextAction[] {
  if (!input.handbookUri) {
    return [];
  }
  return [createHandbookMaintenanceAction({
    handbookUri: input.handbookUri,
    label: 'If maintaining this cognition, read the matching handbook before editing.',
  })];
}

export function statusMcpView(result: StatusOperationResult): StatusMcpView {
  const inspection = result.inspection;

  if (!inspection) {
    const miss = projectStatusMissPresentation(result);
    return {
      cognitionPath: result.cognitionPath,
      cognitionPresence: result.cognitionPath ? 'present' : 'not-applicable',
      status: result.status,
      ownStatus: result.ownStatus,
      descendantStatus: result.descendantStatus,
      ownIssues: [],
      descendantIssues: [],
      handbookUri: null,
      nextActions: statusNextActions({ handbookUri: null }),
      suggestedActions: result.suggestedActions.map(toMcpOperationAction),
      ...miss,
    };
  }

  const resolvedHandbookUri = result.handbookId ? handbookUri(result.handbookId) : null;
  const presentation = projectStatusPresentation(inspection);
  // When the ordered action list already carries a step-local handbook action
  // for this result's handbook (stale maintenance), the ordered list is the
  // source of truth: suppress the duplicate top-level read-before-edit entry
  // instead of surfacing the same handbook twice. The top-level projection
  // remains the fallback for results without a step-local handbook action.
  const hasStepLocalHandbookAction = result.handbookId !== null
    && result.suggestedActions.some((action) => action.handbookId === result.handbookId);

  return {
    ...presentation,
    handbookUri: resolvedHandbookUri,
    nextActions: hasStepLocalHandbookAction ? [] : statusNextActions({ handbookUri: resolvedHandbookUri }),
    suggestedActions: result.suggestedActions.map(toMcpOperationAction),
    pathHints: result.pathHints,
  };
}

export function statusStructuredContent(view: StatusMcpView): StatusMcpView {
  return view;
}
