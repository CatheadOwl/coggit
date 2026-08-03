import type { AddCognitionKind } from '../core';
import type { CoggitProject } from '../core/interfaces';
import { addOperation } from '../core';
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
