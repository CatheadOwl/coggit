/**
 * Public SDK surface for `coggit/runtime-node`.
 *
 * Exposes the reusable Node primitives (fs, config, locks, registry, URI) and
 * the service composition root so non-VS Code runtimes can build on the local
 * filesystem adapters. The watcher observer is adapter-only and stays a deep
 * import (`runtime/node/watch`), outside the v1 reconcile-on-read surface.
 */
import type { CoggitServices } from '../../core/interfaces';
import { createCoggitServices } from '../../core/project';
import { createEnvCoggitLogger } from '../../core/logger';
import { NodeConfigProvider, type NodeConfigDiscoveryMode } from './config';
import { NodeFileSystem } from './fs';
import { NodeProjectLockManager } from './locks';
import { NodeRegistryProviderFactory } from './registry';

export interface CreateNodeServicesOptions {
  workspacePath?: string;
  configDiscovery?: NodeConfigDiscoveryMode;
}

export function createNodeCoggitServices(
  options: CreateNodeServicesOptions = {},
): CoggitServices {
  const logger = createEnvCoggitLogger('[coggit:node]');
  return createCoggitServices({
    fs: new NodeFileSystem(),
    config: new NodeConfigProvider(options.workspacePath, {
      discoveryMode: options.configDiscovery,
    }),
    registry: new NodeRegistryProviderFactory(logger),
    logger,
    locks: new NodeProjectLockManager(),
  });
}

export { NodeFileSystem } from './fs';
export { NodeConfigProvider } from './config';
export {
  NodeProjectLockManager,
  NodeWatchLeaseManager,
  projectWriteLockPath,
  watchLeaseLockPath,
  type NodeProjectLockManagerOptions,
  type NodeWatchLeaseManagerOptions,
} from './locks';
export { NodeRegistryProviderFactory, NodeRegistryProvider } from './registry';
export { pathToUriComponents, uriComponentsToPath } from './uri';
