import * as nodeFs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';

import type { ConfigProvider, UriComponents, WorkspaceFolderInfo } from '@coggit/core';
import { isIgnoredSourceStructureEntry } from '@coggit/core/internal';
import { pathToUriComponents } from './uri';

const CONFIG_PATTERN = '**/.coggit/config.yaml';
const CONFIG_RELATIVE_PATH = path.join('.coggit', 'config.yaml');

export type NodeConfigDiscoveryMode = 'workspace' | 'nearest';

export interface NodeConfigProviderOptions {
  discoveryMode?: NodeConfigDiscoveryMode;
}

export class NodeConfigProvider implements ConfigProvider {
  private readonly workspacePath: string;
  private readonly discoveryMode: NodeConfigDiscoveryMode;

  constructor(workspacePath: string = process.cwd(), options: NodeConfigProviderOptions = {}) {
    this.workspacePath = resolveWorkspacePath(workspacePath);
    this.discoveryMode = options.discoveryMode ?? 'workspace';
  }

  getWorkspaceFolders(): WorkspaceFolderInfo[] {
    return [{
      uri: pathToUriComponents(this.workspacePath),
      name: path.basename(this.workspacePath),
      index: 0,
    }];
  }

  async findFiles(pattern: string): Promise<UriComponents[]> {
    if (pattern !== CONFIG_PATTERN) {
      return [];
    }

    const configPaths = new Set<string>();
    const nearestAncestor = await findNearestAncestorConfig(this.workspacePath);
    if (nearestAncestor) {
      configPaths.add(nearestAncestor);
    }

    if (this.discoveryMode === 'workspace') {
      await collectDescendantConfigs(this.workspacePath, configPaths);
    }
    return Array.from(configPaths)
      .sort((left, right) => left.localeCompare(right))
      .map(pathToUriComponents);
  }
}

function resolveWorkspacePath(workspacePath: string): string {
  const resolved = path.resolve(workspacePath);
  const nearestConfig = findNearestAncestorConfigSync(resolved);
  return nearestConfig
    ? path.dirname(path.dirname(nearestConfig))
    : resolved;
}

function findNearestAncestorConfigSync(startPath: string): string | undefined {
  let current = path.resolve(startPath);
  for (;;) {
    const candidate = path.join(current, CONFIG_RELATIVE_PATH);
    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

async function findNearestAncestorConfig(startPath: string): Promise<string | undefined> {
  let current = path.resolve(startPath);
  for (;;) {
    const candidate = path.join(current, CONFIG_RELATIVE_PATH);
    if (await exists(candidate)) {
      return candidate;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

async function collectDescendantConfigs(rootPath: string, results: Set<string>): Promise<void> {
  let entries: Array<import('node:fs').Dirent>;
  try {
    entries = await nodeFs.readdir(rootPath, { withFileTypes: true });
  } catch {
    return;
  }

  if (entries.some((entry) => entry.isDirectory() && entry.name === '.coggit')) {
    const candidate = path.join(rootPath, CONFIG_RELATIVE_PATH);
    if (await exists(candidate)) {
      results.add(candidate);
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || shouldSkipDirectory(entry.name)) {
      continue;
    }
    await collectDescendantConfigs(path.join(rootPath, entry.name), results);
  }
}

function shouldSkipDirectory(name: string): boolean {
  return isIgnoredSourceStructureEntry(name, true);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await nodeFs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
