import serverInstructions from './prompt-assets/mcp/server-instructions.generated.md';
import explainStatusPrompt from './prompt-assets/mcp/prompts/explain-status.md';
import addToolSurface from './prompt-assets/mcp/tools/coggit-add.generated.js';
import resolveToolSurface from './prompt-assets/mcp/tools/coggit-resolve.generated.js';
import routesToolSurface from './prompt-assets/mcp/tools/coggit-routes.generated.js';
import snapshotToolSurface from './prompt-assets/mcp/tools/coggit-snapshot.generated.js';
import statusToolSurface from './prompt-assets/mcp/tools/coggit-status.generated.js';

export const MCP_SERVER_INSTRUCTIONS = serverInstructions.trim();

export const MCP_PROMPT_ASSETS = [
  {
    sourceName: 'explain-status.md',
    content: explainStatusPrompt,
  },
] as const;

export const MCP_TOOL_SURFACES = {
  add: addToolSurface,
  resolve: resolveToolSurface,
  routes: routesToolSurface,
  snapshot: snapshotToolSurface,
  status: statusToolSurface,
} as const;
