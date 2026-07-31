import type { CoggitProject } from '../core/interfaces';
import { projectSnapshotTree, projectTreeFromSnapshot, snapshotOperation } from '../core';
import { type SnapshotTreeTextOptions } from '../render';
import { renderSnapshotOperationResult } from './operationDto';
import { UserFacingError } from './status';
import { resolveProjectNode } from './util';

export async function runSnapshot(
  projects: readonly CoggitProject[],
  sourcePath: string | undefined,
  options: SnapshotTreeTextOptions & { json?: boolean } = {},
): Promise<string> {
  if (projects.length === 0) {
    throw new UserFacingError('No CogGit project found.');
  }

  const operationSourcePath = sourcePath
    ? (await resolveProjectNode(projects, sourcePath))?.node.relativePath
    : undefined;
  if (sourcePath && !operationSourcePath) {
    throw new UserFacingError(`Path not found in CogGit project: ${sourcePath}`);
  }

  const result = await snapshotOperation(projects, {
    sourcePath: operationSourcePath,
    scope: options.scope,
  });
  if (!result.found) {
    throw new UserFacingError(`Path not found in CogGit project: ${sourcePath}`);
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
