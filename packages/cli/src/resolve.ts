import type { CoggitProject } from '@coggit/core';
import { resolveOperation } from '@coggit/core';
import { renderResolveOperationResult } from './operationDto';
import { UserFacingError } from './status';
import { sourcePathCandidates } from './util';

export async function runResolve(
  projects: readonly CoggitProject[],
  sourcePath: string,
): Promise<string> {
  if (projects.length === 0) {
    throw new UserFacingError('No CogGit project found.');
  }

  const result = await resolveOperation(projects, sourcePath, {
    sourcePathCandidates,
  });
  if (!result.success) {
    throw new UserFacingError(renderResolveOperationResult(result));
  }

  return renderResolveOperationResult(result);
}
