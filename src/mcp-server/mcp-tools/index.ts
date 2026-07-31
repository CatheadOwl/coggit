import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { GetCoggitProjects } from '../project-cache.js';
import { registerAddTool } from './addTool.js';
import { registerResolveTool } from './resolveTool.js';
import { registerRoutesTool } from './routesTool.js';
import { registerSnapshotTool } from './snapshotTool.js';
import { registerStatusTool } from './statusTool.js';

export interface RegisterToolsOptions {
  enabled?: boolean;
}

export interface RegisteredCoggitTools {
  readonly snapshot: RegisteredTool;
  readonly status: RegisteredTool;
  readonly add: RegisteredTool;
  readonly routes: RegisteredTool;
  readonly resolve: RegisteredTool;
}

export function registerTools(
  server: McpServer,
  getProjects: GetCoggitProjects,
  options: RegisterToolsOptions = {},
): RegisteredCoggitTools {
  const snapshot = registerSnapshotTool(server, getProjects);
  const status = registerStatusTool(server, getProjects);
  const add = registerAddTool(server, getProjects);
  const routes = registerRoutesTool(server, getProjects);
  const resolve = registerResolveTool(server, getProjects);

  const tools = { snapshot, status, add, routes, resolve };
  if (options.enabled === false) {
    snapshot.disable();
    status.disable();
    add.disable();
    routes.disable();
    resolve.disable();
  }
  return tools;
}
