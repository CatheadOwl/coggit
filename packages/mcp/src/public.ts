/**
 * Public surface for `@coggit/mcp`.
 *
 * Exposes the MCP protocol server factory (`createCoggitMcpServer`) for
 * programmatic embedding and the stdio runtime entry (`runMcpStdio`) for host
 * bootstraps that ship a copy of the executable. The prompt/tool assets and
 * operation DTOs are package internals.
 */

export { createCoggitMcpServer } from './server.js';
export type { CreateCoggitMcpServerOptions } from './server.js';
export { runMcpStdio } from './mcp-stdio.js';
