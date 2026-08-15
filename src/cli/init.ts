import * as path from 'node:path';

import { initProject } from '../core';
import type { FileSystem } from '../core/interfaces';
import { pathToUriComponents } from '../runtime/node/uri';
import { UserFacingError } from './status';

export interface InitOptions {
  sourceRoot?: string;
  cognitionRoot?: string;
}

export async function runInit(
  fs: FileSystem,
  targetPath: string,
  options: InitOptions = {},
): Promise<string> {
  const sourceRoot = options.sourceRoot === undefined
    ? undefined
    : requireNonEmptyRoot('Source root', options.sourceRoot);
  const cognitionRoot = options.cognitionRoot === undefined
    ? (sourceRoot ? `${sourceRoot}_cognition` : undefined)
    : requireNonEmptyRoot('Cognition root', options.cognitionRoot);

  const target = targetPath || '.';
  const projectRoot = pathToUriComponents(target);
  const configUri = pathToUriComponents(path.join(target, '.coggit', 'config.yaml'));
  if (await fs.exists(configUri)) {
    throw new UserFacingError('CogGit project already initialised at this root. Remove .coggit/config.yaml to re-initialise.');
  }

  await initProject(fs, projectRoot, { sourceRoot, cognitionRoot });

  return `CogGit initialised at ${path.resolve(target)}.`;
}

function requireNonEmptyRoot(label: string, value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new UserFacingError(`${label} cannot be empty.`);
  }
  return trimmed;
}
