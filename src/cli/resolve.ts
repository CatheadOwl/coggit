import type { CoggitProject } from '../core/interfaces';
import { reviewUnchangedOperation } from '../core';
import { renderReviewUnchangedOperationResult } from './operationDto';
import { UserFacingError } from './status';
import { sourcePathCandidates } from './util';

export async function runResolveReviewedUnchanged(
  projects: readonly CoggitProject[],
  sourcePath: string,
): Promise<string> {
  if (projects.length === 0) {
    throw new UserFacingError('No CogGit project found.');
  }

  const result = await reviewUnchangedOperation(projects, sourcePath, {
    sourcePathCandidates,
  });
  if (!result.success) {
    throw new UserFacingError(renderReviewUnchangedOperationResult(result));
  }

  return renderReviewUnchangedOperationResult(result);
}
