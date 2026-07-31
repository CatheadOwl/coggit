import type { AddCognitionKind } from '../core';
import type { CoggitProject } from '../core/interfaces';
import { addOperation } from '../core';
import { renderAddOperationResult } from './operationDto';
import { UserFacingError } from './status';
import { resolveProjectNode } from './util';

export async function runAdd(
  projects: readonly CoggitProject[],
  sourcePath: string,
  kind: AddCognitionKind,
  overwrite: boolean,
): Promise<string> {
  if (projects.length === 0) {
    throw new UserFacingError('No CogGit project found.');
  }

  const resolved = await resolveProjectNode(projects, sourcePath);
  if (!resolved) {
    throw new UserFacingError(`Path not found in CogGit project: ${sourcePath}`);
  }

  const result = await addOperation(projects, resolved.node.relativePath, { kind, overwrite });
  if (!result.success) {
    throw new UserFacingError(renderAddOperationResult(result));
  }

  return renderAddOperationResult(result);
}
