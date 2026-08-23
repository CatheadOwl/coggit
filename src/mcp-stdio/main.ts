import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { discoverCoggitProjects } from '@coggit/core';
import { createNodeCoggitServices } from '../runtime/node/index.js';
import { MCP_PROJECT_DISCOVERY_OPTIONS } from '../mcp-server/project-cache.js';
import { createCoggitMcpServer } from '../mcp-server/server.js';

void main();

async function main(): Promise<void> {
  const services = createNodeCoggitServices();
  const projects = await discoverCoggitProjects(services, MCP_PROJECT_DISCOVERY_OPTIONS);
  const server = createCoggitMcpServer(services, {
    toolsEnabled: projects.length > 0,
    initialProjects: projects,
  });
  const transport = new StdioServerTransport();

  await server.connect(transport);
}
