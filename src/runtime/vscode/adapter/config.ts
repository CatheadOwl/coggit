import * as vscode from 'vscode';
import type { ConfigProvider, UriComponents, WorkspaceFolderInfo } from '@coggit/core';
import { generatedSourceStructureGlobExcludePatterns } from '@coggit/core/internal';
import { toComponents } from './uri';

type FilesExcludeConfig = Record<string, boolean | undefined>;
const CONFIG_DISCOVERY_TIMEOUT_MS = 2000;

export class VscodeConfigProvider implements ConfigProvider {
  getWorkspaceFolders(): WorkspaceFolderInfo[] {
    return (vscode.workspace.workspaceFolders ?? []).map((f, index) => ({
      uri: toComponents(f.uri),
      name: f.name,
      index,
    }));
  }

  async findFiles(pattern: string): Promise<UriComponents[]> {
    const filesExclude = vscode.workspace.getConfiguration('files')
      .get<FilesExcludeConfig>('exclude');
    const uris = await findFilesWithTimeout(pattern, buildConfigDiscoveryExclude(filesExclude));
    return uris.map(toComponents);
  }
}

async function findFilesWithTimeout(pattern: string, exclude: string): Promise<vscode.Uri[]> {
  const cancellation = new vscode.CancellationTokenSource();
  const timeout = setTimeout(() => {
    cancellation.cancel();
  }, CONFIG_DISCOVERY_TIMEOUT_MS);

  try {
    return await vscode.workspace.findFiles(pattern, exclude, undefined, cancellation.token);
  } catch (error) {
    if (cancellation.token.isCancellationRequested) {
      return [];
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    cancellation.dispose();
  }
}

export function buildConfigDiscoveryExclude(filesExclude: FilesExcludeConfig | undefined): string {
  return combineGlobPatterns([
    ...Object.entries(filesExclude ?? {})
      .filter(([pattern, enabled]) => pattern.length > 0 && enabled === true)
      .map(([pattern]) => pattern),
    ...generatedSourceStructureGlobExcludePatterns(),
  ]);
}

function combineGlobPatterns(patterns: readonly string[]): string {
  const uniquePatterns = [...new Set(patterns)];
  return uniquePatterns.length === 1
    ? uniquePatterns[0]
    : `{${uniquePatterns.join(',')}}`;
}
