import { z } from 'zod';

import { RESOLVE_ERROR_CODES } from '../../core/operations.js';
import type { ResolveOperationResult } from '../../core/index.js';
import {
  mcpMaintenanceNextActionSchema,
  projectContextSchema,
  toMcpProjectContext,
} from './shared.js';

export const resolveOperationOutputSchema = {
  success: z.boolean(),
  sourcePath: z.string(),
  cognitionPath: z.string().nullable(),
  sourceKey: z.string().nullable(),
  verificationTimeMs: z.number().nullable(),
  verify: z.object({
    tool: z.literal('coggit_status'),
    sourcePath: z.string(),
  }),
  project: projectContextSchema.nullable(),
  error: z.object({
    code: z.enum(RESOLVE_ERROR_CODES),
    message: z.string(),
  }).nullable(),
  nextActions: z.array(mcpMaintenanceNextActionSchema),
};

export function resolveStructuredContent(result: ResolveOperationResult): {
  success: boolean;
  sourcePath: string;
  cognitionPath: string | null;
  sourceKey: string | null;
  verificationTimeMs: number | null;
  verify: ResolveOperationResult['verify'];
  project: z.infer<typeof projectContextSchema> | null;
  error: ResolveOperationResult['error'];
  nextActions: [];
} {
  return {
    success: result.success,
    sourcePath: result.sourcePath,
    cognitionPath: result.cognitionPath,
    sourceKey: result.sourceKey,
    verificationTimeMs: result.verificationTimeMs,
    verify: result.verify,
    project: result.project ? toMcpProjectContext(result.project) : null,
    error: result.error,
    nextActions: [],
  };
}
