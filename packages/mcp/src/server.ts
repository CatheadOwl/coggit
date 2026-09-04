import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { CoggitProject, CoggitServices } from '@coggit/core';
import { MCP_PROMPT_ASSETS, MCP_SERVER_INSTRUCTIONS } from './promptAssets.js';
import { registerPromptAssets } from './prompt-loader.js';
import { createCoggitProjectCache } from './project-cache.js';
import { registerResources } from './resources.js';
import { registerTools } from './mcp-tools/index.js';

export interface CreateCoggitMcpServerOptions {
  toolsEnabled?: boolean;
  initialProjects?: readonly CoggitProject[];
}

declare const __COGGIT_PACKAGE_VERSION__: string | undefined;

export function createCoggitMcpServer(
  services: CoggitServices,
  options: CreateCoggitMcpServerOptions = {},
): McpServer {
  const server = new McpServer(
    {
      name: 'coggit',
      version:
        typeof __COGGIT_PACKAGE_VERSION__ === 'string'
          ? __COGGIT_PACKAGE_VERSION__
          : '0.0.0-dev',
    },
    {
      capabilities: { tools: {}, resources: {}, prompts: {} },
      instructions: MCP_SERVER_INSTRUCTIONS,
    },
  );

  const getProjects = createCoggitProjectCache(services, {
    initialProjects: options.initialProjects,
  });

  registerTools(server, getProjects, {
    enabled: options.toolsEnabled,
  });
  registerResources(server, getProjects);
  registerPromptAssets(server, MCP_PROMPT_ASSETS);

  return server;
}
