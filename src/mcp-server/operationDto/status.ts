import { z } from 'zod';

import {
  projectStatusPresentation,
  type StatusOperationResult,
  type StatusPresentationView,
} from '../../core/index.js';
import {
  MCP_TOOL_NAMES,
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
  scope: z.enum(['own', 'subtree']),
  status: observedStatusSchema,
  ownStatus: observedStatusSchema,
  descendantStatus: observedStatusSchema,
  ownIssues: z.array(mcpStatusIssueSchema),
  descendantIssues: z.array(mcpStatusIssueSchema),
  handbookUri: z.string().nullable(),
  verify: z.object({
    tool: z.literal('coggit_status'),
  }).nullable(),
  nextActions: z.array(mcpMaintenanceNextActionSchema),
  pathHints: z.array(z.string()),
  pathMissMessage: z.string().optional(),
  pathHintMessage: z.string().optional(),
};

export interface MaintenanceNextAction {
  code: string;
  label: string;
  kind: 'read-resource' | 'read-cognition' | 'verify-status';
  priority: number;
  resourceUri?: string;
  sourcePath?: string;
  cognitionPath?: string;
  tool?: 'coggit_status';
}

export interface StatusMcpView extends StatusPresentationView {
  [key: string]: unknown;
  handbookUri: string | null;
  verify: { tool: 'coggit_status' } | null;
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
    return {
      sourcePath: result.sourcePath,
      cognitionPath: result.cognitionPath,
      cognitionPresence: result.cognitionPath ? 'present' : 'not-applicable',
      scope: 'subtree',
      status: result.status,
      ownStatus: result.ownStatus,
      descendantStatus: result.descendantStatus,
      ownIssues: [],
      descendantIssues: [],
      handbookUri: null,
      verify: result.verify ? { tool: MCP_TOOL_NAMES[result.verify.operation] } : null,
      nextActions: statusNextActions({ handbookUri: null }),
      pathHints: result.pathHints,
      ...(result.pathMissMessage ? { pathMissMessage: result.pathMissMessage } : {}),
      ...(result.pathHintMessage ? { pathHintMessage: result.pathHintMessage } : {}),
    };
  }

  const resolvedHandbookUri = result.handbookId ? handbookUri(result.handbookId) : null;
  const presentation = projectStatusPresentation(inspection, 'subtree');

  return {
    ...presentation,
    handbookUri: resolvedHandbookUri,
    verify: inspection.verify ? { tool: MCP_TOOL_NAMES[inspection.verify.operation] } : null,
    nextActions: statusNextActions({ handbookUri: resolvedHandbookUri }),
    pathHints: result.pathHints,
  };
}

export function statusStructuredContent(view: StatusMcpView): StatusMcpView {
  return view;
}
