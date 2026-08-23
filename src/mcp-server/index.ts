import * as http from 'node:http';
import crypto from 'node:crypto';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { VscodeFileSystem } from '../runtime/vscode/adapter/fs.js';
import { VscodeConfigProvider } from '../runtime/vscode/adapter/config.js';
import { VscodeRegistryProvider } from '../runtime/vscode/adapter/registryFs.js';
import { NodeProjectLockManager } from '../runtime/node/locks.js';
import {
  createCoggitServices,
  discoverCoggitProjects,
  errorLog,
  nullCoggitLogger,
  warnLog,
  type CoggitLogger,
} from '@coggit/core';
import { createCoggitMcpServer } from './server.js';
import { MCP_PROJECT_DISCOVERY_OPTIONS } from './project-cache.js';

// ── Public types ─────────────────────────────────────────────────────────────

export interface McpApp {
  readonly server: http.Server;
  readonly url: string;
  readonly port: number;
  close(): Promise<void>;
}

// ── Create / start ───────────────────────────────────────────────────────────

/**
 * Start the in-process MCP HTTP server.
 *
 * Tries `port` first (default 3098 per the workunit convention). If that port
 * is in use, falls back to a random OS-assigned port so the extension never
 * fails to start due to a port conflict.
 *
 * @param port  Preferred port (default 3098; 0 = random only)
 */
export async function createMcpApp(port = 3098, logger: CoggitLogger = nullCoggitLogger): Promise<McpApp> {
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = http.createServer(async (req, res) => {
    try {
      await handleRequest(req, res, sessions, logger);
    } catch (err) {
      const error = describeError(err);
      errorLog(logger, 'mcp.http', 'Unhandled MCP HTTP error', {
        error: error.message,
        stack: error.stack,
      });
      if (!res.headersSent) {
        res.writeHead(500).end('Internal Server Error');
      }
    }
  });

  // ── Try preferred port; fall back to random on conflict ─────────────────
  const actualPort = await tryListen(httpServer, port, logger);

  return {
    server: httpServer,
    url: `http://localhost:${actualPort}/mcp`,
    port: actualPort,
    close: () => closeSessions(sessions).then(() =>
      new Promise<void>((r) => httpServer.close(() => r())),
    ),
  };
}

export async function closeMcpApp(app: McpApp): Promise<void> {
  return app.close();
}

// ── Request handler ──────────────────────────────────────────────────────────

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessions: Map<string, StreamableHTTPServerTransport>,
  logger: CoggitLogger,
): Promise<void> {
  // Only accept /mcp
  if (req.url !== '/mcp') {
    res.writeHead(404).end('Not Found');
    return;
  }

  const sessionId = readSessionId(req);
  let transport = sessionId ? sessions.get(sessionId) : undefined;

  // ── New session ────────────────────────────────────────────────────────
  if (!transport) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });

    const vfs = new VscodeFileSystem();
    const configProvider = new VscodeConfigProvider();
    const services = createCoggitServices(
      vfs,
      configProvider,
      { create: (projectRoot) => new VscodeRegistryProvider(projectRoot, logger) },
      logger,
      new NodeProjectLockManager(),
    );
    const projects = await discoverCoggitProjects(services, MCP_PROJECT_DISCOVERY_OPTIONS);
    const server = createCoggitMcpServer(services, {
      toolsEnabled: projects.length > 0,
      initialProjects: projects,
    });

    await server.connect(transport);

    transport.onclose = () => {
      if (transport!.sessionId) {
        sessions.delete(transport!.sessionId);
      }
    };
  }

  // ── Route request through transport ────────────────────────────────────
  // StreamableHTTPServerTransport uses @hono/node-server under the hood to
  // convert Node.js IncomingMessage/ServerResponse to Web Standard Request.
  // We do NOT pre-read the body — the transport reads it via the conversion.
  await transport.handleRequest(req, res);

  // Register session after first successful handleRequest (which sets
  // sessionId on the transport internally during the initialize exchange).
  if (!sessionId && transport.sessionId) {
    sessions.set(transport.sessionId, transport);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function readSessionId(
  req: http.IncomingMessage,
): string | undefined {
  return req.headers['mcp-session-id'] as string | undefined;
}

async function closeSessions(
  sessions: Map<string, StreamableHTTPServerTransport>,
): Promise<void> {
  const promises: Promise<void>[] = [];
  for (const [id, t] of sessions) {
    promises.push(t.close().catch(() => {}));
    sessions.delete(id);
  }
  await Promise.all(promises);
}

// ── Port fallback ────────────────────────────────────────────────────────────

/**
 * Listen on `preferredPort`. If EADDRINUSE, fall back to port 0 (OS assigns).
 */
async function tryListen(
  server: http.Server,
  preferredPort: number,
  logger: CoggitLogger,
): Promise<number> {
  if (preferredPort === 0) {
    return listenOnce(server, 0);
  }

  try {
    return await listenOnce(server, preferredPort);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as any).code === 'EADDRINUSE') {
      warnLog(logger, 'mcp.http', 'Preferred MCP HTTP port in use; falling back to random port', {
        preferredPort,
      });
      return listenOnce(server, 0);
    }
    throw err;
  }
}

function listenOnce(server: http.Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      const addr = server.address();
      resolve(addr && typeof addr === 'object' ? addr.port : port);
    });
  });
}

function describeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    message: String(error),
  };
}
