# @coggit/mcp

CogGit MCP runtime: a stdio MCP server exposing CogGit status, snapshot,
routes, add, and resolve as tools, plus cognition handbooks as prompts.

Peer dependency: `@modelcontextprotocol/sdk` (install it alongside this
package — embedders run an MCP SDK by definition).

## Install

```sh
npm install @coggit/mcp @modelcontextprotocol/sdk
```

## Usage

Programmatic embedding:

```ts
import { createNodeCoggitServices } from '@coggit/runtime-node';
import { createCoggitMcpServer } from '@coggit/mcp';

const services = createNodeCoggitServices();
const server = createCoggitMcpServer(services, { toolsEnabled: true });
// connect the McpServer to your transport
```

Standalone stdio binary (also available as `npx coggit-mcp` after install):

```sh
coggit-mcp
```

## Surface notes

- The `.` export exposes only `createCoggitMcpServer` and `runMcpStdio`
  (see `src/public.ts`); tool/prompt assets and operation DTOs are internals.

Architecture, concepts, and workflow docs live in the
[repository root](https://github.com/CatheadOwl/coggit#readme).
