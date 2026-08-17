import * as vscode from 'vscode';
import type { ConfigProvider, UriComponents, WorkspaceFolderInfo } from '../../../core/interfaces';
import { generatedSourceStructureGlobExcludePatterns } from '../../../core/sourceStructureIgnore';
import { toComponents } from './uri';

type FilesExcludeConfig = Record<string, boolean | undefined>;

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
    const uris = await vscode.workspace.findFiles(pattern, buildConfigDiscoveryExclude(filesExclude));
    return uris.map(toComponents);
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
