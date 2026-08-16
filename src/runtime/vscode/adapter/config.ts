import * as vscode from 'vscode';
import type { ConfigProvider, UriComponents, WorkspaceFolderInfo } from '../../../core/interfaces';
import { generatedSourceStructureGlobExclude } from '../../../core/sourceStructureIgnore';
import { toComponents } from './uri';

export class VscodeConfigProvider implements ConfigProvider {
  getWorkspaceFolders(): WorkspaceFolderInfo[] {
    return (vscode.workspace.workspaceFolders ?? []).map((f, index) => ({
      uri: toComponents(f.uri),
      name: f.name,
      index,
    }));
  }

  async findFiles(pattern: string): Promise<UriComponents[]> {
    const uris = await vscode.workspace.findFiles(pattern, generatedSourceStructureGlobExclude());
    return uris.map(toComponents);
  }
}
