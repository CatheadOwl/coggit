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
      ...miss,
    };
  }

  const resolvedHandbookUri = result.handbookId ? handbookUri(result.handbookId) : null;
  const presentation = projectStatusPresentation(inspection);

  return {
    ...presentation,
    handbookUri: resolvedHandbookUri,
    nextActions: statusNextActions({ handbookUri: resolvedHandbookUri }),
    pathHints: result.pathHints,
  };
}

export function statusStructuredContent(view: StatusMcpView): StatusMcpView {
  return view;
}
