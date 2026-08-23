import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { discoverCoggitProjects } from '@coggit/core';
import { createNodeCoggitServices } from '@coggit/runtime-node';
import { MCP_PROJECT_DISCOVERY_OPTIONS } from './project-cache.js';
import { createCoggitMcpServer } from './server.js';

export async function runMcpStdio(): Promise<void> {
  const services = createNodeCoggitServices();
  const projects = await discoverCoggitProjects(services, MCP_PROJECT_DISCOVERY_OPTIONS);
  const server = createCoggitMcpServer(services, {
    toolsEnabled: projects.length > 0,
    initialProjects: projects,
  });
  const transport = new StdioServerTransport();

  await server.connect(transport);
}
