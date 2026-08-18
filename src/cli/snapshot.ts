import type { CoggitProject } from '../core/interfaces';
import { projectSnapshotTree, projectTreeFromSnapshot, snapshotOperation } from '../core';
import { type SnapshotTreeTextOptions } from '../render';
import { renderSnapshotOperationResult } from './operationDto';
import { UserFacingError } from './status';
import { defaultSourcePathInput, sourcePathCandidates } from './util';

export async function runSnapshot(
  projects: readonly CoggitProject[],
  sourcePath: string | undefined,
  options: SnapshotTreeTextOptions & { json?: boolean } = {},
): Promise<string> {
  if (projects.length === 0) {
    throw new UserFacingError('No CogGit project found.');
  }

  const effectiveSourcePath = sourcePath ?? defaultSourcePathInput();
  const result = await snapshotOperation(projects, {
    sourcePath: effectiveSourcePath,
    scope: options.scope,
    maxDepth: options.maxDepth,
    sourcePathCandidates,
  });
  if (!result.found) {
    throw new UserFacingError(renderSnapshotOperationResult(result, options));
  }

  if (options.json) {
    const projection = result.node
      ? projectTreeFromSnapshot(result.node, { depth: options.maxDepth, scope: options.scope })
      : result.snapshot
        ? projectSnapshotTree(result.snapshot, { depth: options.maxDepth, scope: options.scope })
        : [];
    return JSON.stringify(projection, null, 2);
  }

  return renderSnapshotOperationResult(result, options);
}
