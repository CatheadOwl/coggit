import * as assert from 'node:assert';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';

import {
  ensureCoggitMcpEntry,
  inspectCoggitMcpEntry,
  migrateLegacyCoggitMcpEntry,
  removeCoggitMcpEntry,
  type CoggitStdioMcpEntry,
} from './mcpJson';

suite('mcpJson adapter', () => {
  let tempDir: string;
  let workspaceRoot: vscode.Uri;

  const entry: CoggitStdioMcpEntry = {
    command: 'node',
    args: ['dist/mcp-stdio.js'],
    cwd: 'fixture-workspace',
  };

  setup(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coggit-mcp-json-'));
    workspaceRoot = vscode.Uri.file(tempDir);
  });

  teardown(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('reports missing when .mcp.json does not exist', async () => {
    const status = await inspectCoggitMcpEntry(workspaceRoot, entry);

    assert.deepStrictEqual(status, { kind: 'missing' });
  });

  test('creates only mcpServers.coggit and preserves unrelated keys', async () => {
    await writeMcpJson({
      mcpServers: {
        other: { type: 'stdio', command: 'other', args: [] },
      },
      note: 'keep me',
    });

    await ensureCoggitMcpEntry(workspaceRoot, entry);

    assert.deepStrictEqual(await readMcpJson(), {
      mcpServers: {
        other: { type: 'stdio', command: 'other', args: [] },
        coggit: {
          type: 'stdio',
          command: 'node',
          args: ['dist/mcp-stdio.js'],
          cwd: 'fixture-workspace',
        },
      },
      note: 'keep me',
    });
  });

  test('reports configured when the CogGit entry matches', async () => {
    await ensureCoggitMcpEntry(workspaceRoot, entry);

    const status = await inspectCoggitMcpEntry(workspaceRoot, entry);

    assert.deepStrictEqual(status, { kind: 'configured' });
  });

  test('reports conflict when the CogGit entry differs', async () => {
    await writeMcpJson({
      mcpServers: {
        coggit: { type: 'stdio', command: 'node', args: ['old.js'] },
      },
    });

    const status = await inspectCoggitMcpEntry(workspaceRoot, entry);

    assert.deepStrictEqual(status, { kind: 'conflict' });
  });

  test('migrates an extension-managed MCP entry to the stable launcher', async () => {
    await writeMcpJson({
      mcpServers: {
        other: { type: 'stdio', command: 'other', args: [] },
        coggit: {
          type: 'stdio',
          command: 'node',
          args: ['.fixture/extensions/coggit.coggit-0.1.0/dist/mcp-stdio.js'],
          cwd: 'fixture-workspace',
        },
      },
      note: 'keep me',
    });
    const stableEntry: CoggitStdioMcpEntry = {
      ...entry,
      args: ['.fixture/coggit/bin/coggit-mcp.js'],
    };

    const migrated = await migrateLegacyCoggitMcpEntry(
      workspaceRoot,
      stableEntry,
      '.fixture/extension-under-development/dist/mcp-stdio.js',
    );

    assert.strictEqual(migrated, true);
    assert.deepStrictEqual(await readMcpJson(), {
      mcpServers: {
        other: { type: 'stdio', command: 'other', args: [] },
        coggit: {
          type: 'stdio',
          command: 'node',
          args: ['.fixture/coggit/bin/coggit-mcp.js'],
          cwd: 'fixture-workspace',
        },
      },
      note: 'keep me',
    });
  });

  test('does not automatically migrate a customized legacy entry', async () => {
    await writeMcpJson({
      mcpServers: {
        coggit: {
          type: 'stdio',
          command: 'node',
          args: ['.fixture/extensions/coggit.coggit-0.1.0/dist/mcp-stdio.js'],
          cwd: 'fixture-workspace',
          env: { COGGIT_CUSTOM: '1' },
        },
      },
    });

    const migrated = await migrateLegacyCoggitMcpEntry(
      workspaceRoot,
      { ...entry, args: ['.fixture/coggit/bin/coggit-mcp.js'] },
      '.fixture/extension-under-development/dist/mcp-stdio.js',
    );

    assert.strictEqual(migrated, false);
    assert.deepStrictEqual(
      (await readMcpJson()).mcpServers.coggit.env,
      { COGGIT_CUSTOM: '1' },
    );
  });

  test('reports invalidJson and leaves malformed files unchanged', async () => {
    const mcpJsonUri = vscode.Uri.joinPath(workspaceRoot, '.mcp.json');
    await vscode.workspace.fs.writeFile(mcpJsonUri, new TextEncoder().encode('{'));

    const status = await inspectCoggitMcpEntry(workspaceRoot, entry);
    await ensureCoggitMcpEntry(workspaceRoot, entry);

    assert.deepStrictEqual(status, { kind: 'invalidJson' });
    assert.strictEqual(await readRawMcpJson(), '{');
  });

  test('reports invalidShape when the root is not an object', async () => {
    await writeRawMcpJson('[]\n');

    const status = await inspectCoggitMcpEntry(workspaceRoot, entry);

    assert.deepStrictEqual(status, { kind: 'invalidShape' });
  });

  test('reports invalidShape when mcpServers is not an object', async () => {
    await writeMcpJson({ mcpServers: [] });

    const status = await inspectCoggitMcpEntry(workspaceRoot, entry);

    assert.deepStrictEqual(status, { kind: 'invalidShape' });
  });

  test('does not rewrite invalidShape files', async () => {
    await writeMcpJson({ mcpServers: [] });

    await ensureCoggitMcpEntry(workspaceRoot, entry);
    await removeCoggitMcpEntry(workspaceRoot);

    assert.deepStrictEqual(await readMcpJson(), { mcpServers: [] });
  });

  test('removes only mcpServers.coggit', async () => {
    await ensureCoggitMcpEntry(workspaceRoot, entry);
    await writeMcpJson({
      ...(await readMcpJson()),
      mcpServers: {
        ...(await readMcpJson()).mcpServers,
        other: { type: 'stdio', command: 'other', args: [] },
      },
    });

    await removeCoggitMcpEntry(workspaceRoot);

    assert.deepStrictEqual(await readMcpJson(), {
      mcpServers: {
        other: { type: 'stdio', command: 'other', args: [] },
      },
    });
  });

  async function writeMcpJson(value: unknown): Promise<void> {
    await writeRawMcpJson(JSON.stringify(value, null, 2) + '\n');
  }

  async function writeRawMcpJson(value: string): Promise<void> {
    const mcpJsonUri = vscode.Uri.joinPath(workspaceRoot, '.mcp.json');
    await vscode.workspace.fs.writeFile(mcpJsonUri, new TextEncoder().encode(value));
  }

  async function readMcpJson(): Promise<any> {
    return JSON.parse(await readRawMcpJson());
  }

  async function readRawMcpJson(): Promise<string> {
    const mcpJsonUri = vscode.Uri.joinPath(workspaceRoot, '.mcp.json');
    const raw = await vscode.workspace.fs.readFile(mcpJsonUri);
    return new TextDecoder().decode(raw);
  }
});
