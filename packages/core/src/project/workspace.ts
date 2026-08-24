import { parse as parseYaml } from 'yaml';

import type { CoggitConfig, CoggitWorkspaceRoot } from '../types';
import type { ConfigProvider, FileSystem, UriComponents, WorkspaceFolderInfo } from '../interfaces';
import type { CoggitLogger } from '../logger';
import { errorLog, warnLog } from '../logger';
import { resolveConfigRoots, toRelativeUriPath } from '../mapping';
import { formatUri, joinUriPath, uriBasename, uriKey } from '../uri-utils';

export async function discoverWorkspaceRoots(
  fs: FileSystem,
  config: ConfigProvider,
  logger?: CoggitLogger,
): Promise<CoggitWorkspaceRoot[]> {
  const workspaceFolders = config.getWorkspaceFolders();
  const roots: CoggitWorkspaceRoot[] = [];

  const configUris = await discoverConfigUris(fs, config);
  for (const configUri of configUris) {
    const configPath = configUri.path.replace(/\\/g, '/');
    const workspaceFolder = workspaceFolders.find((wf) => {
      const wfPath = wf.uri.path.replace(/\\/g, '/');
      const normalized = wfPath.endsWith('/') ? wfPath : `${wfPath}/`;
      return configPath.startsWith(normalized);
    }) ?? workspaceFolders[0];

    if (!workspaceFolder) {
      continue;
    }

    const root = await readWorkspaceRoot(fs, workspaceFolder, configUri, logger);
    if (root) {
      roots.push(root);
    }
  }

  return roots.sort((left, right) =>
    left.label.localeCompare(right.label),
  );
}

async function discoverConfigUris(
  fs: FileSystem,
  config: ConfigProvider,
): Promise<UriComponents[]> {
  const workspaceFolders = config.getWorkspaceFolders();
  const byKey = new Map<string, UriComponents>();
  for (const workspaceFolder of workspaceFolders) {
    const directConfigUri = joinUriPath(workspaceFolder.uri, '.coggit', 'config.yaml');
    if (await fs.stat(directConfigUri)) {
      byKey.set(uriKey(directConfigUri), directConfigUri);
    }
  }

  const discovered = await config.findFiles('**/.coggit/config.yaml');
  for (const uri of discovered) {
    byKey.set(uriKey(uri), uri);
  }

  return Array.from(byKey.values());
}

export async function readWorkspaceRoot(
  fs: FileSystem,
  workspaceFolder: WorkspaceFolderInfo,
  configUri: UriComponents,
  logger?: CoggitLogger,
): Promise<CoggitWorkspaceRoot | undefined> {
  try {
    const raw = await fs.readFile(configUri);
    const parsed = parseYaml(raw) as Partial<Record<string, unknown>> | null;
    const sourceRoot =
      typeof parsed?.source_root === 'string'
        ? parsed.source_root
        : undefined;
    const cognitionRoot =
      typeof parsed?.cognition_root === 'string'
        ? parsed.cognition_root
        : undefined;
    if (!sourceRoot || !cognitionRoot) {
      warnLog(logger, 'config.parse', 'Skipping malformed config', {
        configUri: formatUri(configUri),
      });
      return undefined;
    }

    const configData: CoggitConfig = { sourceRoot, cognitionRoot };
    const { projectRootUri, sourceRootUri, cognitionRootUri } =
      resolveConfigRoots(configUri, configData);
    const relativeProjectPath = toRelativeUriPath(workspaceFolder.uri, projectRootUri);
    const label = relativeProjectPath !== '.'
      ? relativeProjectPath
      : uriBasename(projectRootUri) || workspaceFolder.name;

    return {
      id: uriKey(configUri),
      label,
      workspaceFolder,
      configUri,
      projectRootUri,
      sourceRootUri,
      cognitionRootUri,
    };
  } catch (error) {
    errorLog(logger, 'config.parse', 'Failed to read config', {
      configUri: formatUri(configUri),
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}
