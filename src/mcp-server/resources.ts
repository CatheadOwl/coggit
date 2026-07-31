import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  getCognitionHandbook,
  handbookCatalog,
  projectContext,
} from '../core/index.js';
import type { CognitionKind } from '../core/index.js';
import type { GetCoggitProjects } from './project-cache.js';
export const PROJECTS_RESOURCE_URI = 'coggit://projects';
export const COGNITION_ROOTS_RESOURCE_URI = 'coggit://cognition-root';

export function registerResources(
  server: McpServer,
  getProjects: GetCoggitProjects,
): void {
  server.registerResource(
    'coggit-cognition-root',
    COGNITION_ROOTS_RESOURCE_URI,
    {
      title: 'CogGit Cognition Roots',
      description: 'Configured CogGit cognition roots from .coggit/config.yaml. Read this before locating cognition files.',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [
        {
          uri: COGNITION_ROOTS_RESOURCE_URI,
          mimeType: 'application/json',
          text: JSON.stringify(await listCognitionRoots(getProjects), null, 2),
        },
      ],
    }),
  );

  server.registerResource(
    'coggit-projects',
    PROJECTS_RESOURCE_URI,
    {
      title: 'CogGit Projects',
      description: 'Diagnostic CogGit project context, including source and cognition roots.',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [
        {
          uri: PROJECTS_RESOURCE_URI,
          mimeType: 'application/json',
          text: JSON.stringify(await listProjectContexts(getProjects), null, 2),
        },
      ],
    }),
  );

  for (const entry of handbookCatalog()) {
    if (entry.kind === 'all') {
      continue;
    }
    registerHandbookResource(server, entry.kind, entry.title);
  }
}

async function listCognitionRoots(getProjects: GetCoggitProjects): Promise<unknown[]> {
  const projects = await getProjects();
  return projects.map((project) => ({
    cognitionRoot: projectContext(project).cognitionRoot,
  }));
}

async function listProjectContexts(getProjects: GetCoggitProjects): Promise<unknown[]> {
  const projects = await getProjects();
  return projects.map((project) => projectContext(project));
}

function registerHandbookResource(
  server: McpServer,
  kind: CognitionKind,
  description: string,
): void {
  const uri = `coggit://handbook/${kind}`;
  server.registerResource(
    `coggit-handbook-${kind}`,
    uri,
    {
      title: `CogGit ${kind} Handbook`,
      description,
      mimeType: 'text/markdown',
    },
    async () => ({
      contents: [
        {
          uri,
          mimeType: 'text/markdown',
          text: getCognitionHandbook(kind).content,
        },
      ],
    }),
  );
}
