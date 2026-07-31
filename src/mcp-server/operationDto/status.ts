import { z } from 'zod';

import type { StatusOperationResult } from '../../core/index.js';
import type { LocatedStatusIssue, ObservedStatus } from '../../core/types.js';
import { toRelativeUriPath } from '../../core/index.js';
import type { UriComponents } from '../../core/interfaces.js';
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

export interface StatusMcpView {
  [key: string]: unknown;
  sourcePath: string;
  cognitionPath: string | null;
  status: ObservedStatus | null;
  ownStatus: ObservedStatus | null;
  descendantStatus: ObservedStatus | null;
  ownIssues: Array<{
    sourcePath: string;
    cognitionPath: string | null;
    severity: string;
    suggestedActions: string[];
  }>;
  descendantIssues: Array<{
    sourcePath: string;
    cognitionPath: string | null;
    severity: string;
    suggestedActions: string[];
  }>;
  handbookUri: string | null;
  verify: { tool: 'coggit_status' } | null;
  nextActions: MaintenanceNextAction[];
}

function toMcpStatusIssue(
  located: LocatedStatusIssue,
  rootCognitionUri: UriComponents,
): ReturnType<typeof mcpStatusIssueSchema.parse> {
  return {
    sourcePath: located.relativePath,
    cognitionPath: located.cognitionUri
      ? toRelativeUriPath(rootCognitionUri, located.cognitionUri)
      : null,
    severity: located.issue.diagnostic.severity,
    suggestedActions: located.issue.actions.map((a) => a.label),
  };
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
      status: result.status,
      ownStatus: result.ownStatus,
      descendantStatus: result.descendantStatus,
      ownIssues: [],
      descendantIssues: [],
      handbookUri: null,
      verify: result.verify ? { tool: 'coggit_status' } : null,
      nextActions: statusNextActions({ handbookUri: null }),
    };
  }

  const rootCognitionUri = result.node?.root.cognitionRootUri;
  const mapIssue = rootCognitionUri
    ? (located: LocatedStatusIssue) => toMcpStatusIssue(located, rootCognitionUri)
    : (located: LocatedStatusIssue) => ({
        sourcePath: located.relativePath,
        cognitionPath: null,
        severity: located.issue.diagnostic.severity,
        suggestedActions: located.issue.actions.map((a) => a.label),
      });

  const resolvedHandbookUri = result.handbookId ? handbookUri(result.handbookId) : null;

  return {
    sourcePath: inspection.sourcePath,
    cognitionPath: inspection.cognitionPath,
    status: inspection.status,
    ownStatus: inspection.ownStatus,
    descendantStatus: inspection.descendantStatus,
    ownIssues: inspection.subtreeIssues.own.map(mapIssue),
    descendantIssues: inspection.subtreeIssues.descendant.map(mapIssue),
    handbookUri: resolvedHandbookUri,
    verify: inspection.verify ? { tool: 'coggit_status' } : null,
    nextActions: statusNextActions({ handbookUri: resolvedHandbookUri }),
  };
}

export function statusStructuredContent(view: StatusMcpView): StatusMcpView {
  return view;
}
