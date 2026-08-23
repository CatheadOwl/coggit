import * as path from 'node:path';

import { initProject } from '@coggit/core';
import type { FileSystem } from '@coggit/core';
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
  requireValidRootPath(label, trimmed);
  return trimmed;
}

/**
 * Reject root paths that are not simple project-relative directory paths.
 *
 * Accepts slash-separated relative paths like `src`, `lib/internal`.
 * Rejects absolute paths, `.`/`..` segments, empty segments, and paths
 * whose canonical form differs from the input.
 */
function requireValidRootPath(label: string, value: string): void {
  // Absolute POSIX path: /foo
  if (value.startsWith('/')) {
    throw new UserFacingError(`${label} must be a project-relative path, not absolute: "${value}".`);
  }
  // Windows drive path: C:/, C:\, or drive-relative C:tmp
  if (/^[a-zA-Z]:/u.test(value)) {
    throw new UserFacingError(`${label} must be a project-relative path, not a drive path: "${value}".`);
  }
  // Backslash anywhere: foo\bar, UNC \\server\share
  if (value.includes('\\')) {
    throw new UserFacingError(`${label} must use forward slashes, not backslashes: "${value}".`);
  }

  const segments = value.split('/');
  for (const seg of segments) {
    if (seg === '') {
      throw new UserFacingError(`${label} contains empty segments (repeated slashes): "${value}".`);
    }
    if (seg === '.' || seg === '..') {
      throw new UserFacingError(`${label} must not contain "." or ".." segments: "${value}".`);
    }
  }

  // Reject paths whose canonical form differs from the input
  // (catches redundant separators, mixed styles).
  const canonical = segments.join('/');
  if (canonical !== value) {
    throw new UserFacingError(`${label} is not in canonical form (expected "${canonical}"): "${value}".`);
  }
}
