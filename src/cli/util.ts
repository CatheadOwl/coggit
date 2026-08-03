import * as path from 'node:path';

import type { CoggitProject } from '../core/interfaces';
import type { SourcePathCandidatesExpander } from '../core';
import { uriRelativePath } from '../core';
import { pathToUriComponents } from '../runtime/node/uri';

/**
 * Runtime source-path candidate expander: map a raw CLI input path into the
 * candidate source-root-relative forms to try per project. Operations consume
 * this via their `sourcePathCandidates` option, so the CLI renders the
 * operation result (including fuzzy hints) instead of re-deriving it.
 */
export const sourcePathCandidates: SourcePathCandidatesExpander = (
  project: CoggitProject,
  inputPath: string,
): string[] => {
  const candidates = new Set<string>();
  const normalized = normalizeCliPath(inputPath);
  candidates.add(normalized);

  const projectRelative = uriRelativePath(
    project.root.projectRootUri,
    pathToUriComponents(path.resolve(inputPath)),
  );
  if (projectRelative !== undefined) {
    candidates.add(projectRelative);
  }

  const sourceRelative = uriRelativePath(
    project.root.sourceRootUri,
    pathToUriComponents(path.resolve(inputPath)),
  );
  if (sourceRelative !== undefined) {
    candidates.add(sourceRelative);
  }

  const sourceRootProjectRelative = uriRelativePath(
    project.root.projectRootUri,
    project.root.sourceRootUri,
  );
  if (sourceRootProjectRelative && normalized.startsWith(`${sourceRootProjectRelative}/`)) {
    candidates.add(normalized.slice(sourceRootProjectRelative.length + 1));
  }

  return Array.from(candidates);
};

function normalizeCliPath(inputPath: string): string {
  const normalized = inputPath.replace(/\\/g, '/').replace(/\/+$/u, '');
  return normalized.length === 0 ? '.' : normalized;
}
