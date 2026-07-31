import * as path from 'node:path';
import * as vscode from 'vscode';
import type { CoggitLogger } from '../../../core/logger';
import { nullCoggitLogger, warnLog } from '../../../core/logger';

interface McpJson {
  mcpServers?: Record<string, unknown>;
}

type ReadMcpJsonResult =
  | { kind: 'ok'; data: McpJson }
  | { kind: 'missing'; data: McpJson }
  | { kind: 'invalidJson' }
  | { kind: 'invalidShape' };

export interface CoggitStdioMcpEntry {
  command: string;
  args: string[];
  cwd?: string;
}

export type CoggitMcpEntryStatus =
  | { kind: 'configured' }
  | { kind: 'missing' }
  | { kind: 'conflict' }
  | { kind: 'invalidJson' }
  | { kind: 'invalidShape' };

export async function inspectCoggitMcpEntry(
  workspaceRoot: vscode.Uri,
  entry: CoggitStdioMcpEntry,
  logger: CoggitLogger = nullCoggitLogger,
): Promise<CoggitMcpEntryStatus> {
  const mcpJsonUri = vscode.Uri.joinPath(workspaceRoot, '.mcp.json');
  const result = await readMcpJson(mcpJsonUri, logger);

  if (result.kind === 'invalidJson') {
    return { kind: 'invalidJson' };
  }
  if (result.kind === 'invalidShape') {
    return { kind: 'invalidShape' };
  }

  const { data } = result;
  const existing = data.mcpServers?.['coggit'] as Record<string, unknown> | undefined;
  if (!existing) {
    return { kind: 'missing' };
  }

  if (isMatchingCoggitMcpEntry(existing, entry)) {
    return { kind: 'configured' };
  }

  return { kind: 'conflict' };
}

export async function ensureCoggitMcpEntry(
  workspaceRoot: vscode.Uri,
  entry: CoggitStdioMcpEntry,
  logger: CoggitLogger = nullCoggitLogger,
): Promise<void> {
  const mcpJsonUri = vscode.Uri.joinPath(workspaceRoot, '.mcp.json');
  const result = await readMcpJson(mcpJsonUri, logger);

  if (result.kind === 'invalidJson' || result.kind === 'invalidShape') {
    return;
  }

  const { data } = result;
  data.mcpServers ??= {};

  const existing = data.mcpServers['coggit'] as Record<string, unknown> | undefined;
  if (existing && isMatchingCoggitMcpEntry(existing, entry)) {
    return;
  }

  data.mcpServers['coggit'] = {
    type: 'stdio',
    command: entry.command,
    args: entry.args,
    ...(entry.cwd ? { cwd: entry.cwd } : {}),
  };

  await vscode.workspace.fs.writeFile(
    mcpJsonUri,
    new TextEncoder().encode(JSON.stringify(data, null, 2) + '\n'),
  );
}

export async function removeCoggitMcpEntry(
  workspaceRoot: vscode.Uri,
  logger: CoggitLogger = nullCoggitLogger,
): Promise<void> {
  const mcpJsonUri = vscode.Uri.joinPath(workspaceRoot, '.mcp.json');
  const result = await readMcpJson(mcpJsonUri, logger);

  if (result.kind === 'invalidJson' || result.kind === 'invalidShape') {
    return;
  }

  const { data } = result;
  if (!data.mcpServers || !Object.prototype.hasOwnProperty.call(data.mcpServers, 'coggit')) {
    return;
  }

  delete data.mcpServers['coggit'];
  if (Object.keys(data.mcpServers).length === 0) {
    delete data.mcpServers;
  }

  await vscode.workspace.fs.writeFile(
    mcpJsonUri,
    new TextEncoder().encode(JSON.stringify(data, null, 2) + '\n'),
  );
}

export async function migrateLegacyCoggitMcpEntry(
  workspaceRoot: vscode.Uri,
  entry: CoggitStdioMcpEntry,
  bundledEntryPath: string,
  logger: CoggitLogger = nullCoggitLogger,
): Promise<boolean> {
  const mcpJsonUri = vscode.Uri.joinPath(workspaceRoot, '.mcp.json');
  const result = await readMcpJson(mcpJsonUri, logger);
  if (result.kind === 'invalidJson' || result.kind === 'invalidShape') {
    return false;
  }

  const existing = result.data.mcpServers?.['coggit'] as Record<string, unknown> | undefined;
  if (
    !existing
    || isMatchingCoggitMcpEntry(existing, entry)
    || !isManagedLegacyCoggitMcpEntry(existing, entry.cwd, bundledEntryPath)
  ) {
    return false;
  }

  result.data.mcpServers!['coggit'] = toMcpJsonEntry(entry);
  await writeMcpJson(mcpJsonUri, result.data);
  return true;
}

async function readMcpJson(
  mcpJsonUri: vscode.Uri,
  logger: CoggitLogger,
): Promise<ReadMcpJsonResult> {
  let raw: Uint8Array;
  try {
    raw = await vscode.workspace.fs.readFile(mcpJsonUri);
  } catch {
    return { kind: 'missing', data: {} };
  }

  try {
    const parsed = JSON.parse(new TextDecoder().decode(raw)) as unknown;
    if (!isPlainObject(parsed)) {
      warnLog(logger, 'mcp.registration', 'Ignoring .mcp.json with non-object root', {
        path: mcpJsonUri.fsPath,
      });
      return { kind: 'invalidShape' };
    }
    if (
      Object.prototype.hasOwnProperty.call(parsed, 'mcpServers')
      && !isPlainObject(parsed.mcpServers)
    ) {
      warnLog(logger, 'mcp.registration', 'Ignoring .mcp.json with non-object mcpServers', {
        path: mcpJsonUri.fsPath,
      });
      return { kind: 'invalidShape' };
    }
    return { kind: 'ok', data: parsed as McpJson };
  } catch (err) {
    warnLog(logger, 'mcp.registration', 'Ignoring unparseable .mcp.json; leaving file unchanged', {
      path: mcpJsonUri.fsPath,
      error: err instanceof Error ? err.message : String(err),
    });
    return { kind: 'invalidJson' };
  }
}

function isMatchingCoggitMcpEntry(
  existing: Record<string, unknown>,
  entry: CoggitStdioMcpEntry,
): boolean {
  return existing.type === 'stdio'
    && existing.command === entry.command
    && arraysEqual(existing.args, entry.args)
    && optionalPathsEqual(existing.cwd, entry.cwd);
}

function isManagedLegacyCoggitMcpEntry(
  existing: Record<string, unknown>,
  expectedCwd: string | undefined,
  bundledEntryPath: string,
): boolean {
  const knownKeys = new Set(['type', 'command', 'args', 'cwd']);
  if (Object.keys(existing).some((key) => !knownKeys.has(key))) {
    return false;
  }

  if (
    existing.type !== 'stdio'
    || existing.command !== 'node'
    || !Array.isArray(existing.args)
    || existing.args.length !== 1
    || typeof existing.args[0] !== 'string'
    || !optionalPathsEqual(existing.cwd, expectedCwd)
  ) {
    return false;
  }

  const legacyEntryPath = existing.args[0];
  if (filesystemPathsEqual(legacyEntryPath, bundledEntryPath)) {
    return true;
  }

  const portablePath = legacyEntryPath.replace(/\\/g, '/');
  return /\/extensions\/coggit\.coggit-[^/]+\/dist\/mcp-stdio\.js$/i.test(portablePath);
}

function optionalPathsEqual(left: unknown, right: string | undefined): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return typeof left === 'string' && filesystemPathsEqual(left, right);
}

function filesystemPathsEqual(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function toMcpJsonEntry(entry: CoggitStdioMcpEntry): Record<string, unknown> {
  return {
    type: 'stdio',
    command: entry.command,
    args: entry.args,
    ...(entry.cwd ? { cwd: entry.cwd } : {}),
  };
}

async function writeMcpJson(mcpJsonUri: vscode.Uri, data: McpJson): Promise<void> {
  await vscode.workspace.fs.writeFile(
    mcpJsonUri,
    new TextEncoder().encode(JSON.stringify(data, null, 2) + '\n'),
  );
}

function arraysEqual(left: unknown, right: string[]): boolean {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value);
}
