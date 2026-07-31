import * as path from 'node:path';

import type { CoggitProject } from '../core/interfaces';
import type { CoggitTreeNode } from '../core/types';
import { uriRelativePath } from '../core';
import { pathToUriComponents } from '../runtime/node/uri';

export interface ResolvedProjectNode {
  project: CoggitProject;
  node: CoggitTreeNode;
}

export async function resolveProjectNode(
  projects: readonly CoggitProject[],
  inputPath: string,
): Promise<ResolvedProjectNode | undefined> {
  for (const project of projects) {
    for (const candidate of getSourcePathCandidates(project, inputPath)) {
      const node = await project.getNode(candidate);
      if (node) {
        return { project, node };
      }
    }
  }

  return undefined;
}

function getSourcePathCandidates(project: CoggitProject, inputPath: string): string[] {
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
}

function normalizeCliPath(inputPath: string): string {
  const normalized = inputPath.replace(/\\/g, '/').replace(/\/+$/u, '');
  return normalized.length === 0 ? '.' : normalized;
}
