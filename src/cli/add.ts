import type { AddCognitionKind } from '@coggit/core';
import type { CoggitProject } from '@coggit/core';
import { addOperation } from '@coggit/core';
import { renderAddOperationResult } from './operationDto';
import { UserFacingError } from './status';
import { sourcePathCandidates } from './util';

export async function runAdd(
  projects: readonly CoggitProject[],
  sourcePath: string,
  kind: AddCognitionKind,
  overwrite: boolean,
): Promise<string> {
  if (projects.length === 0) {
    throw new UserFacingError('No CogGit project found.');
  }

  const result = await addOperation(projects, sourcePath, {
    kind,
    overwrite,
    sourcePathCandidates,
  });
  if (!result.success) {
    throw new UserFacingError(renderAddOperationResult(result));
  }

  return renderAddOperationResult(result);
}
