import { z } from 'zod';

import { RESOLVE_ERROR_CODES } from '@coggit/core/internal';
import type { ResolveOperationResult } from '@coggit/core';
import {
  externalPathOrNull,
  mcpMaintenanceNextActionSchema,
  operationActionSchema,
  projectContextSchema,
  toMcpOperationAction,
  toMcpProjectContext,
} from './shared.js';

export const resolveOperationOutputSchema = {
  success: z.boolean(),
  sourcePath: z.string(),
  sourceUri: z.string().nullable(),
  cognitionPath: z.string().nullable(),
  cognitionUri: z.string().nullable(),
  sourceKey: z.string().nullable(),
  verificationTimeMs: z.number().nullable(),
  project: projectContextSchema.nullable(),
  error: z.object({
    code: z.enum(RESOLVE_ERROR_CODES),
    message: z.string(),
  }).nullable(),
  nextActions: z.array(mcpMaintenanceNextActionSchema),
  suggestedActions: z.array(operationActionSchema),
};

export function resolveStructuredContent(result: ResolveOperationResult): {
  success: boolean;
  sourcePath: string;
  sourceUri: string | null;
  cognitionPath: string | null;
  cognitionUri: string | null;
  sourceKey: string | null;
  verificationTimeMs: number | null;
  project: z.infer<typeof projectContextSchema> | null;
  error: ResolveOperationResult['error'];
  nextActions: [];
  suggestedActions: Array<z.infer<typeof operationActionSchema>>;
} {
  return {
    success: result.success,
    sourcePath: result.sourcePath,
    sourceUri: externalPathOrNull(result.sourceUri),
    cognitionPath: result.cognitionPath,
    cognitionUri: externalPathOrNull(result.cognitionUri),
    sourceKey: result.sourceKey,
    verificationTimeMs: result.verificationTimeMs,
    project: result.project ? toMcpProjectContext(result.project) : null,
    error: result.error,
    nextActions: [],
    suggestedActions: result.suggestedActions.map(toMcpOperationAction),
  };
}
