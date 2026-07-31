import { discoverCoggitProjects } from '../core/index.js';
import type { CoggitProject, CoggitServices } from '../core/interfaces.js';
import type { CoggitProjectDiscoveryOptions } from '../core/index.js';

export type GetCoggitProjects = () => Promise<CoggitProject[]>;

export const MCP_PROJECT_DISCOVERY_OPTIONS = {
  registryInitFailure: 'throw',
} satisfies CoggitProjectDiscoveryOptions;

export interface CoggitProjectCacheOptions {
  initialProjects?: readonly CoggitProject[];
}

export function createCoggitProjectCache(
  services: CoggitServices,
  options: CoggitProjectCacheOptions = {},
): GetCoggitProjects {
  let cachedProjects: CoggitProject[] | null = options.initialProjects
    ? [...options.initialProjects]
    : null;
  let shouldEnsureFreshBeforeUse = false;

  return async () => {
    if (!cachedProjects) {
      cachedProjects = await discoverCoggitProjects(services, MCP_PROJECT_DISCOVERY_OPTIONS);
      shouldEnsureFreshBeforeUse = false;
    } else if (shouldEnsureFreshBeforeUse) {
      await Promise.all(cachedProjects.map((p) => p.ensureFresh()));
    }
    shouldEnsureFreshBeforeUse = true;
    return cachedProjects;
  };
}
