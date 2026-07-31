import { z } from 'zod';

import { REVIEW_UNCHANGED_ERROR_CODES } from '../../core/operations.js';
import type { ReviewUnchangedOperationResult } from '../../core/index.js';
import {
  mcpMaintenanceNextActionSchema,
  projectContextSchema,
  toMcpProjectContext,
} from './shared.js';

export const RESOLVE_REVIEWED_UNCHANGED = 'reviewed_unchanged' as const;

export const resolveOperationOutputSchema = {
  success: z.boolean(),
  resolution: z.literal(RESOLVE_REVIEWED_UNCHANGED),
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
    code: z.enum(REVIEW_UNCHANGED_ERROR_CODES),
    message: z.string(),
  }).nullable(),
  nextActions: z.array(mcpMaintenanceNextActionSchema),
};

export function resolveStructuredContent(result: ReviewUnchangedOperationResult): {
  success: boolean;
  resolution: typeof RESOLVE_REVIEWED_UNCHANGED;
  sourcePath: string;
  cognitionPath: string | null;
  sourceKey: string | null;
  verificationTimeMs: number | null;
  verify: ReviewUnchangedOperationResult['verify'];
  project: z.infer<typeof projectContextSchema> | null;
  error: ReviewUnchangedOperationResult['error'];
  nextActions: [];
} {
  return {
    success: result.success,
    resolution: RESOLVE_REVIEWED_UNCHANGED,
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
