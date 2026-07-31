import type { CoggitProject } from '../core/interfaces';
import { statusOperation } from '../core';
import { renderStatusSectionsText } from '../render';
import { renderStatusOperationResult } from './operationDto';
import { resolveProjectNode } from './util';

export type StatusMode = 'aggregate' | 'own' | 'subtree';

export async function runStatus(
  projects: readonly CoggitProject[],
  sourcePath: string | undefined,
  mode: StatusMode,
): Promise<string> {
  if (projects.length === 0) {
    throw new UserFacingError('No CogGit project found.');
  }

  if (!sourcePath) {
    return runProjectRootStatus(projects, mode);
  }

  const resolved = await resolveProjectNode(projects, sourcePath);
  if (!resolved) {
    throw new UserFacingError(`Path not found in CogGit project: ${sourcePath}`);
  }

  const result = await statusOperation(projects, resolved.node.relativePath);
  return renderStatusOperationResult(result, mode);
}

export class UserFacingError extends Error {}

async function runProjectRootStatus(
  projects: readonly CoggitProject[],
  mode: StatusMode,
): Promise<string> {
  const sections: string[] = [];
  for (const project of projects) {
    const result = await statusOperation([project], '.');
    if (!result.found) {
      continue;
    }

    sections.push(renderStatusOperationResult(result, mode));
  }

  if (sections.length === 0) {
    throw new UserFacingError('No CogGit project root node found.');
  }
  return renderStatusSectionsText(sections);
}
