import type { CoggitProject } from '@coggit/core';
import { statusOperation } from '@coggit/core';
import { renderStatusOperationResult } from './operationDto';
import { defaultSourcePathInput, sourcePathCandidates } from './util';

export async function runStatus(
  projects: readonly CoggitProject[],
  sourcePath: string | undefined,
): Promise<string> {
  if (projects.length === 0) {
    throw new UserFacingError('No CogGit project found.');
  }

  const result = await statusOperation(projects, sourcePath ?? defaultSourcePathInput(), {
    sourcePathCandidates,
  });
  if (!result.found) {
    throw new UserFacingError(renderStatusOperationResult(result));
  }
  return renderStatusOperationResult(result);
}

export class UserFacingError extends Error {}
