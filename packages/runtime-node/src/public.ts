/**
 * Public SDK surface for `@coggit/runtime-node`.
 *
 * Exposes the reusable Node primitives (fs, config, locks, registry, URI) and
 * the service composition root so non-VS Code runtimes can build on the local
 * filesystem adapters. The watcher observer and watch-lease primitives are
 * adapter/CLI-private and live in `internal.ts` (the `@coggit/runtime-node/internal`
 * export), outside the v1 reconcile-on-read surface.
 */
import type { CoggitServices } from '@coggit/core';
import { createCoggitServices } from '@coggit/core';
import { createEnvCoggitLogger } from '@coggit/core';
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
  projectWriteLockPath,
  type NodeProjectLockManagerOptions,
} from './locks';
export { NodeRegistryProviderFactory, NodeRegistryProvider } from './registry';
export { pathToUriComponents, uriComponentsToPath } from './uri';
