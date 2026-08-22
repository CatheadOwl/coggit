import * as path from 'node:path';

import { ensureMcpRuntime } from '../runtime-support/mcp/userMcpRuntime.js';
import { UserFacingError } from './status';

export interface McpInstallOptions {
  bundledEntryPath: string;
  version: string;
  installedBy: string;
  homeDirectory?: string;
  json?: boolean;
}

export async function runMcpInstall(options: McpInstallOptions): Promise<string> {
  try {
    const installation = await ensureMcpRuntime({
      bundledEntryPath: options.bundledEntryPath,
      version: options.version,
      installedBy: options.installedBy,
      homeDirectory: options.homeDirectory,
    });

    if (options.json) {
      return JSON.stringify(installation, null, 2);
    }

    return [
      `CogGit MCP launcher: ${installation.launcherPath}`,
      `Active version: ${installation.activeVersion}`,
      `Active integrity: ${installation.activeIntegrity}`,
      `Changed: ${installation.changed ? 'yes' : 'no'}`,
    ].join('\n');
  } catch (error) {
    throw new UserFacingError(error instanceof Error ? error.message : String(error));
  }
}

export function resolveBundledMcpEntryPath(currentDirectory: string): string {
  return path.resolve(currentDirectory, 'mcp-stdio.js');
}
