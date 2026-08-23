import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import type { RegistryFile } from '@coggit/core';
import { createNodeCoggitServices } from '../runtime/node/index.js';
import { createCoggitMcpServer } from './server.js';

interface McpTestSession {
  readonly client: Client;
  close(): Promise<void>;
}

interface StatusContent {
  readonly status: string | null;
}

interface AcceptedPairContent {
  readonly source: string;
  readonly cognition: string;
}

interface ResolveContent {
  readonly success: boolean;
  readonly sourceKey: string | null;
  readonly verificationTimeMs: number | null;
}

const LEAF_COGNITION = [
  '# Tracked module',
  '',
  'This module owns a stable tracked value used by the fixture.',
  '',
  'Its design contract remains valid when the source literal changes.',
].join('\n');

suite('MCP resolve E2E — real filesystem registry persistence', function () {
  this.timeout(20_000);

  let tmpdir: string;
  let sessions: McpTestSession[];

  setup(() => {
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'coggit-mcp-resolve-'));
    sessions = [];
    writeProjectFiles(tmpdir);
  });

  teardown(async () => {
    await Promise.all(sessions.map((session) => session.close()));
    fs.rmSync(tmpdir, { recursive: true, force: true });
  });

  test('resolves stale cognition through MCP and survives a server restart', async () => {
    const firstSession = await openSession(tmpdir);
    sessions.push(firstSession);

    const listedTools = await firstSession.client.listTools();
    assert.ok(
      listedTools.tools.some((tool) => tool.name === 'coggit_resolve'),
      'coggit_resolve should be registered for a configured project',
    );

    const baseline = await callStatus(firstSession.client);
    assert.strictEqual(baseline.status, 'fresh');

    const sourcePath = path.join(tmpdir, 'src', 'tracked.ts');
    fs.writeFileSync(sourcePath, 'export const tracked = 2;\n');
    const sourceChangeTime = new Date(Date.now() - 1_000);
    fs.utimesSync(sourcePath, sourceChangeTime, sourceChangeTime);

    const stale = await callStatus(firstSession.client);
    assert.strictEqual(stale.status, 'stale');

    const resolveResult = await firstSession.client.callTool({
      name: 'coggit_resolve',
      arguments: {
        sourcePath: 'tracked.ts',
      },
    });
    assert.notStrictEqual(resolveResult.isError, true);

    const resolved = resolveResult.structuredContent as ResolveContent | undefined;
    assert.ok(resolved, 'resolve should return structured content');
    assert.strictEqual(resolved.success, true);
    assert.strictEqual(resolved.sourceKey, 'tracked.ts');
    assert.ok(resolved.verificationTimeMs !== null);

    const registry = readRegistry(tmpdir);
    assert.ok(
      registry.entries['tracked.ts']?.accepted,
      'accepted pair should be persisted by MCP resolve',
    );

    const freshAfterResolve = await callStatus(firstSession.client);
    assert.strictEqual(freshAfterResolve.status, 'fresh');

    await firstSession.close();

    const restartedSession = await openSession(tmpdir);
    sessions.push(restartedSession);
    const freshAfterRestart = await callStatus(restartedSession.client);
    assert.strictEqual(
      freshAfterRestart.status,
      'fresh',
      'a new MCP server should load the persisted reviewed evidence',
    );
  });

  test('serves embedded prompts without a runtime asset directory', async () => {
    const session = await openSession(tmpdir);
    sessions.push(session);

    const listedPrompts = await session.client.listPrompts();
    const explainStatus = listedPrompts.prompts.find(
      (prompt) => prompt.name === 'explain-status',
    );
    assert.ok(explainStatus, 'explain-status should be registered from embedded assets');
    assert.strictEqual(explainStatus.arguments?.[0]?.name, 'sourcePath');
    assert.strictEqual(explainStatus.arguments?.[0]?.required, true);

    const rendered = await session.client.getPrompt({
      name: 'explain-status',
      arguments: {
        sourcePath: 'tracked.ts',
        detail: 'brief',
      },
    });
    const content = rendered.messages[0]?.content;
    assert.strictEqual(content?.type, 'text');
    assert.match(
      content?.type === 'text' ? content.text : '',
      /Cognition Status: tracked\.ts/,
    );
  });

  test('projects dual-hash transitions through user-facing status', async () => {
    const session = await openSession(tmpdir);
    sessions.push(session);

    // [A, B] — first substantive observation bootstraps the accepted pair.
    assert.strictEqual((await callStatus(session.client)).status, 'fresh');
    const acceptedAB = readAcceptedPair(tmpdir);
    assert.ok(acceptedAB, 'baseline status should persist an accepted pair');

    // [A, b] — cognition-only change is passively accepted because the source
    // identity is unchanged.
    fs.writeFileSync(
      path.join(tmpdir, 'cognition', 'tracked.ts.md'),
      `${LEAF_COGNITION}\n\nThis is a cognition-only edit.`,
    );
    assert.strictEqual((await callStatus(session.client)).status, 'fresh');
    const acceptedAb = readAcceptedPair(tmpdir);
    assert.ok(acceptedAb);
    assert.notStrictEqual(acceptedAb.cognition, acceptedAB.cognition);
    assert.strictEqual(acceptedAb.source, acceptedAB.source);

    // [a, b] — source-only change is visible to the user as stale.
    fs.writeFileSync(
      path.join(tmpdir, 'src', 'tracked.ts'),
      'export const tracked = 2;\n',
    );
    assert.strictEqual((await callStatus(session.client)).status, 'stale');
    assert.deepStrictEqual(readAcceptedPair(tmpdir), acceptedAb);

    // [a, c] — both identities differ from the accepted pair and no ordering
    // evidence exists. The user-facing status remains stale; the runtime
    // acceptance layer simply refuses to write the pair automatically.
    fs.writeFileSync(
      path.join(tmpdir, 'cognition', 'tracked.ts.md'),
      `${LEAF_COGNITION}\n\nThis edit follows an unaccepted source change.`,
    );
    assert.strictEqual((await callStatus(session.client)).status, 'stale');
    assert.deepStrictEqual(readAcceptedPair(tmpdir), acceptedAb);

    // [A, c] — returning the source to its accepted content makes this a
    // cognition-only change again; current content identity, not mtime, wins.
    fs.writeFileSync(
      path.join(tmpdir, 'src', 'tracked.ts'),
      'export const tracked = 1;\n',
    );
    assert.strictEqual((await callStatus(session.client)).status, 'fresh');
    const acceptedAc = readAcceptedPair(tmpdir);
    assert.ok(acceptedAc);
    assert.strictEqual(acceptedAc.source, acceptedAB.source);
    assert.notStrictEqual(acceptedAc.cognition, acceptedAb.cognition);

    // [A, B] — restoring the original cognition content also restores the
    // original content identity and remains fresh.
    fs.writeFileSync(path.join(tmpdir, 'cognition', 'tracked.ts.md'), LEAF_COGNITION);
    assert.strictEqual((await callStatus(session.client)).status, 'fresh');
    const acceptedFinal = readAcceptedPair(tmpdir);
    assert.ok(acceptedFinal);
    assert.strictEqual(acceptedFinal.source, acceptedAB.source);
    assert.strictEqual(acceptedFinal.cognition, acceptedAB.cognition);
  });
});

function writeProjectFiles(workspacePath: string): void {
  fs.mkdirSync(path.join(workspacePath, '.coggit'), { recursive: true });
  fs.writeFileSync(
    path.join(workspacePath, '.coggit', 'config.yaml'),
    'source_root: src\ncognition_root: cognition\n',
  );

  fs.mkdirSync(path.join(workspacePath, 'src'), { recursive: true });
  fs.mkdirSync(path.join(workspacePath, 'cognition'), { recursive: true });

  const sourcePath = path.join(workspacePath, 'src', 'tracked.ts');
  const cognitionPath = path.join(workspacePath, 'cognition', 'tracked.ts.md');
  fs.writeFileSync(sourcePath, 'export const tracked = 1;\n');
  fs.writeFileSync(cognitionPath, LEAF_COGNITION);

  const baselineSourceTime = new Date(Date.now() - 20_000);
  const baselineCognitionTime = new Date(Date.now() - 10_000);
  fs.utimesSync(sourcePath, baselineSourceTime, baselineSourceTime);
  fs.utimesSync(cognitionPath, baselineCognitionTime, baselineCognitionTime);
}

async function openSession(workspacePath: string): Promise<McpTestSession> {
  const services = createNodeCoggitServices({ workspacePath });
  const server = createCoggitMcpServer(services, { toolsEnabled: true });
  const client = new Client({ name: 'coggit-mcp-e2e', version: '0.1.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  let closed = false;
  return {
    client,
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      await client.close();
    },
  };
}

async function callStatus(client: Client): Promise<StatusContent> {
  const result = await client.callTool({
    name: 'coggit_status',
    arguments: { sourcePath: 'tracked.ts' },
  });
  assert.notStrictEqual(result.isError, true);
  const structuredContent = result.structuredContent as StatusContent | undefined;
  assert.ok(structuredContent, 'status should return structured content');
  return structuredContent;
}

function readRegistry(workspacePath: string): RegistryFile {
  return JSON.parse(
    fs.readFileSync(path.join(workspacePath, '.coggit', 'registry.json'), 'utf8'),
  ) as RegistryFile;
}

function readAcceptedPair(workspacePath: string): AcceptedPairContent | null {
  return readRegistry(workspacePath).entries['tracked.ts']?.accepted ?? null;
}
