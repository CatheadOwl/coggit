import type { CoggitServices } from '../../core/interfaces';
import { createCoggitServices, createEnvCoggitLogger } from '../../core';
import { NodeConfigProvider } from './config';
import { NodeFileSystem } from './fs';
import { NodeProjectLockManager } from './locks';
import { NodeRegistryProviderFactory } from './registry';

export interface CreateNodeServicesOptions {
  workspacePath?: string;
}

export function createNodeCoggitServices(
  options: CreateNodeServicesOptions = {},
): CoggitServices {
  const logger = createEnvCoggitLogger('[coggit:node]');
  return createCoggitServices({
    fs: new NodeFileSystem(),
    config: new NodeConfigProvider(options.workspacePath),
    registry: new NodeRegistryProviderFactory(logger),
    logger,
    locks: new NodeProjectLockManager(),
  });
}
