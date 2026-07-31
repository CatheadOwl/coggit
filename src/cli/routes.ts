import {
  assembleRoutesContent,
  routesOperation,
} from '../core';
import type { CoggitProject } from '../core/interfaces';
import { routesContentText } from '../format';
import { UserFacingError } from './status';

export type RoutesFormat = 'flat' | 'tree';

export interface RoutesCliOptions {
  depth?: number;
  format?: RoutesFormat;
  json?: boolean;
}

export async function runRoutes(
  projects: readonly CoggitProject[],
  sourcePath: string | undefined,
  options: RoutesCliOptions = {},
): Promise<string> {
  if (projects.length === 0) {
    throw new UserFacingError('No CogGit project found.');
  }

  const project = projects[0];
  const result = await routesOperation(project, { includeHeadings: false });
  const content = assembleRoutesContent(
    { entries: result.entries, project: result.project },
    {
      sourcePath,
      depth: options.depth,
      format: options.format,
      projectRootUri: project.root.projectRootUri,
      sourceRootUri: project.root.sourceRootUri,
    },
  );

  if (options.json) {
    return JSON.stringify(content, null, 2);
  }

  return routesContentText(content, 'cli');
}
