import { z } from 'zod';

import { ADD_OPERATION_ERROR_CODES } from '../../core/index.js';
import type { AddOperationResult, CognitionKind } from '../../core/index.js';
import {
  MCP_TOOL_NAMES,
  createHandbookMaintenanceAction,
  handbookUri,
  mcpMaintenanceNextActionSchema,
  projectContextSchema,
  toMcpProjectContext,
} from './shared.js';

export const addOperationOutputSchema = {
  success: z.boolean(),
  created: z.boolean().nullable(),
  kind: z.enum(['leaf', 'skeleton']).nullable(),
  sourcePath: z.string(),
  cognitionPath: z.string().nullable(),
  handbookUri: z.string().nullable(),
  verify: z.object({
    tool: z.literal('coggit_status'),
    sourcePath: z.string(),
  }),
  project: projectContextSchema.nullable(),
  error: z.object({
    code: z.enum(ADD_OPERATION_ERROR_CODES),
    message: z.string(),
  }).nullable(),
  nextActions: z.array(mcpMaintenanceNextActionSchema),
  pathHints: z.array(z.string()),
  pathMissMessage: z.string().optional(),
  pathHintMessage: z.string().optional(),
};

function addNextActions(result: AddOperationResult): ReturnType<typeof createHandbookMaintenanceAction>[] {
  if (!result.success || !result.handbookId) {
    return [];
  }

  return [createHandbookMaintenanceAction({
    handbookUri: handbookUri(result.handbookId),
    label: 'Read the matching handbook before completing the created cognition template.',
  })];
}

export function addStructuredContent(result: AddOperationResult): {
  success: boolean;
  created: boolean | null;
  kind: CognitionKind | null;
  sourcePath: string;
  cognitionPath: string | null;
  handbookUri: string | null;
  verify: z.infer<typeof addOperationOutputSchema['verify']>;
  project: z.infer<typeof projectContextSchema> | null;
  error: AddOperationResult['error'];
  nextActions: ReturnType<typeof createHandbookMaintenanceAction>[];
  pathHints: string[];
  pathMissMessage?: string;
  pathHintMessage?: string;
} {
  return {
    success: result.success,
    created: result.created,
    kind: result.kind,
    sourcePath: result.sourcePath,
    cognitionPath: result.cognitionPath,
    handbookUri: result.handbookId ? handbookUri(result.handbookId) : null,
    verify: {
      tool: MCP_TOOL_NAMES[result.verify.operation],
      sourcePath: result.verify.sourcePath,
    },
    project: result.project ? toMcpProjectContext(result.project) : null,
    error: result.error,
    nextActions: addNextActions(result),
    pathHints: result.pathHints,
    ...(result.pathMissMessage ? { pathMissMessage: result.pathMissMessage } : {}),
    ...(result.pathHintMessage ? { pathHintMessage: result.pathHintMessage } : {}),
  };
}
