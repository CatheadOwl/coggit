import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { CoggitProject, CoggitServices } from '../core/interfaces.js';
import { MCP_PROMPT_ASSETS, MCP_SERVER_INSTRUCTIONS } from '../promptAssets.js';
import { registerPromptAssets } from './prompt-loader.js';
import { createCoggitProjectCache } from './project-cache.js';
import { registerResources } from './resources.js';
import { registerTools } from './mcp-tools/index.js';

export interface CreateCoggitMcpServerOptions {
  toolsEnabled?: boolean;
  initialProjects?: readonly CoggitProject[];
}

export function createCoggitMcpServer(
  services: CoggitServices,
  options: CreateCoggitMcpServerOptions = {},
): McpServer {
  const server = new McpServer(
    { name: 'coggit', version: '0.1.0' },
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
