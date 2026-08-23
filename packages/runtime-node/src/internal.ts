/**
 * Full internal barrel for `@coggit/runtime-node` (the `./internal` export).
 *
 * Mirrors the public surface plus the adapter/CLI-private watcher observer
 * that `public.ts` deliberately omits (v1 is reconcile-on-read; sustained
 * watcher authority stays out of the external SDK contract).
 */
export { createNodeCoggitServices, type CreateNodeServicesOptions } from './public';
export { NodeFileSystem } from './fs';
export {
  NodeConfigProvider,
  type NodeConfigDiscoveryMode,
  type NodeConfigProviderOptions,
} from './config';
export {
  NodeProjectLockManager,
  projectWriteLockPath,
  type NodeProjectLockManagerOptions,
} from './locks';
export { NodeRegistryProviderFactory, NodeRegistryProvider } from './registry';
export { pathToUriComponents, uriComponentsToPath } from './uri';

// ─── Internal-only surface (monorepo consumers via `@coggit/runtime-node/internal`) ───
// Watch authority is adapter/CLI-private (v1 is reconcile-on-read): the lease
// manager + lock path and the @parcel/watcher observer stay off the public `.`
// export.

export {
  NodeWatchLeaseManager,
  watchLeaseLockPath,
  type NodeWatchLeaseManagerOptions,
} from './locks';
export {
  createNodeFileWatchObserver,
  type NodeFileWatchObserverOptions,
} from './watch';
