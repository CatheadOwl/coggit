import * as vscode from 'vscode';
import type { FileSystem, FileStat, UriComponents } from '@coggit/core';

export class VscodeFileSystem implements FileSystem {
  async readFile(uri: UriComponents): Promise<string> {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.from(uri));
    return new TextDecoder().decode(bytes);
  }

  async writeFile(uri: UriComponents, content: string): Promise<void> {
    await vscode.workspace.fs.writeFile(vscode.Uri.from(uri), new TextEncoder().encode(content));
  }

  async stat(uri: UriComponents): Promise<FileStat | undefined> {
    try {
      const s = await vscode.workspace.fs.stat(vscode.Uri.from(uri));
      return { isDirectory: (s.type & vscode.FileType.Directory) !== 0, mtimeMs: s.mtime };
    } catch { return undefined; }
  }

  async readDirectory(uri: UriComponents): Promise<Array<[string, number]>> {
    return vscode.workspace.fs.readDirectory(vscode.Uri.from(uri));
  }

  async exists(uri: UriComponents): Promise<boolean> {
    return (await this.stat(uri)) !== undefined;
  }

  async createDirectory(uri: UriComponents): Promise<void> {
    await vscode.workspace.fs.createDirectory(vscode.Uri.from(uri));
  }

  async delete(uri: UriComponents): Promise<void> {
    try {
      await vscode.workspace.fs.delete(vscode.Uri.from(uri));
    } catch {
      // no-op if file doesn't exist
    }
  }
}
