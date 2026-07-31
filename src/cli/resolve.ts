import type { CoggitProject } from '../core/interfaces';
import { reviewUnchangedOperation } from '../core';
import { renderReviewUnchangedOperationResult } from './operationDto';
import { UserFacingError } from './status';
import { resolveProjectNode } from './util';

export async function runResolveReviewedUnchanged(
  projects: readonly CoggitProject[],
  sourcePath: string,
): Promise<string> {
  if (projects.length === 0) {
    throw new UserFacingError('No CogGit project found.');
  }

  const resolved = await resolveProjectNode(projects, sourcePath);
  if (!resolved) {
    throw new UserFacingError(`Path not found in CogGit project: ${sourcePath}`);
  }

  const result = await reviewUnchangedOperation(projects, resolved.node.relativePath);
  return renderReviewUnchangedOperationResult(result);
}
