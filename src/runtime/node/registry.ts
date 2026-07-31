import * as nodeFs from 'node:fs/promises';
import * as path from 'node:path';

import type { RegistryFile, RegistryProvider } from '../../core/types';
import type { RegistryProviderFactory, UriComponents } from '../../core/interfaces';
import type { CoggitLogger } from '../../core/logger';
import { warnLog } from '../../core/logger';
import { uriComponentsToPath } from './uri';

export class NodeRegistryProviderFactory implements RegistryProviderFactory {
  constructor(private readonly logger?: CoggitLogger) {}

  create(projectRoot: UriComponents): RegistryProvider {
    return new NodeRegistryProvider(projectRoot, this.logger);
  }
}

export class NodeRegistryProvider implements RegistryProvider {
  private readonly coggitDir: string;
  private readonly registryPath: string;
  private readonly registryTmpPath: string;
  private readonly registryBakPath: string;

  constructor(
    projectRoot: UriComponents,
    private readonly logger?: CoggitLogger,
  ) {
    this.coggitDir = path.join(uriComponentsToPath(projectRoot), '.coggit');
    this.registryPath = path.join(this.coggitDir, 'registry.json');
    this.registryTmpPath = path.join(this.coggitDir, 'registry.json.tmp');
    this.registryBakPath = path.join(this.coggitDir, 'registry.json.bak');
  }

  async load(): Promise<RegistryFile | null> {
    let raw: string;
    try {
      raw = await nodeFs.readFile(this.registryPath, 'utf8');
    } catch {
      return null;
    }

    try {
      return JSON.parse(raw) as RegistryFile;
    } catch {
      return this.restoreFromBackup();
    }
  }

  async save(file: RegistryFile): Promise<void> {
    const serialized = JSON.stringify(file, null, 2);
    await nodeFs.mkdir(this.coggitDir, { recursive: true });
    await nodeFs.writeFile(this.registryTmpPath, serialized, 'utf8');
    await nodeFs.rename(this.registryTmpPath, this.registryPath);

    try {
      await nodeFs.writeFile(this.registryBakPath, serialized, 'utf8');
    } catch {
      warnLog(this.logger, 'registry.io', 'Failed to write registry backup');
    }
  }

  private async restoreFromBackup(): Promise<RegistryFile | null> {
    try {
      const backup = await nodeFs.readFile(this.registryBakPath, 'utf8');
      const data = JSON.parse(backup) as RegistryFile;
      await nodeFs.writeFile(this.registryPath, backup, 'utf8');
      warnLog(this.logger, 'registry.io', 'registry.json corrupted, restored from backup');
      return data;
    } catch {
      return null;
    }
  }
}
