import { discoverCoggitProjects } from '@coggit/core';
import type { CoggitProject, CoggitServices } from '@coggit/core';
import type { CoggitProjectDiscoveryOptions } from '@coggit/core';

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
