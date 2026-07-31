import * as nodeFs from 'node:fs/promises';
import * as path from 'node:path';

import type { FileStat, FileSystem, UriComponents } from '../../core/interfaces';
import { uriComponentsToPath } from './uri';

const FILE_TYPE_FILE = 1;
const FILE_TYPE_DIRECTORY = 2;

export class NodeFileSystem implements FileSystem {
  async readFile(uri: UriComponents): Promise<string> {
    return nodeFs.readFile(uriComponentsToPath(uri), 'utf8');
  }

  async writeFile(uri: UriComponents, content: string): Promise<void> {
    const filePath = uriComponentsToPath(uri);
    await nodeFs.mkdir(path.dirname(filePath), { recursive: true });
    await nodeFs.writeFile(filePath, content, 'utf8');
  }

  async stat(uri: UriComponents): Promise<FileStat | undefined> {
    try {
      const stat = await nodeFs.stat(uriComponentsToPath(uri));
      return {
        isDirectory: stat.isDirectory(),
        mtimeMs: stat.mtimeMs,
      };
    } catch (error) {
      if (isNotFoundError(error)) {
        return undefined;
      }
      throw error;
    }
  }

  async readDirectory(uri: UriComponents): Promise<Array<[string, number]>> {
    const entries = await nodeFs.readdir(uriComponentsToPath(uri), {
      withFileTypes: true,
    });
    return entries.map((entry) => [
      entry.name,
      entry.isDirectory() ? FILE_TYPE_DIRECTORY : FILE_TYPE_FILE,
    ]);
  }

  async exists(uri: UriComponents): Promise<boolean> {
    return (await this.stat(uri)) !== undefined;
  }

  async createDirectory(uri: UriComponents): Promise<void> {
    await nodeFs.mkdir(uriComponentsToPath(uri), { recursive: true });
  }

  async delete(uri: UriComponents): Promise<void> {
    try {
      await nodeFs.rm(uriComponentsToPath(uri), { force: true, recursive: true });
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }
  }
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
