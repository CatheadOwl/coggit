import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { runMcpInstall } from './mcpInstall';

suite('CLI MCP install', () => {
  let tempDirectory: string;
  let homeDirectory: string;
  let bundledEntryPath: string;

  setup(async () => {
    tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'coggit-cli-mcp-install-'));
    homeDirectory = path.join(tempDirectory, 'home');
    bundledEntryPath = path.join(tempDirectory, 'dist', 'mcp-stdio.js');
    await fs.mkdir(path.dirname(bundledEntryPath), { recursive: true });
    await fs.writeFile(bundledEntryPath, "process.stdout.write('runtime');\n");
  });

  teardown(async () => {
    await fs.rm(tempDirectory, { recursive: true, force: true });
  });

  test('prints installation details without project discovery inputs', async () => {
    const output = await runMcpInstall({
      bundledEntryPath,
      version: '1.2.3',
      installedBy: 'cli',
      homeDirectory,
    });

    assert.match(output, /CogGit MCP launcher:/);
    assert.match(output, /Active version: 1\.2\.3/);
    assert.match(output, /Active integrity: sha256:[a-f0-9]{64}/);
    assert.match(output, /Changed: yes/);
  });

  test('prints structured installation JSON', async () => {
    const output = await runMcpInstall({
      bundledEntryPath,
      version: '1.2.3',
      installedBy: 'cli',
      homeDirectory,
      json: true,
    });
    const parsed = JSON.parse(output) as Record<string, unknown>;

    assert.strictEqual(typeof parsed.launcherPath, 'string');
    assert.strictEqual(typeof parsed.runtimeEntryPath, 'string');
    assert.strictEqual(parsed.activeVersion, '1.2.3');
    assert.match(String(parsed.activeIntegrity), /^sha256:[a-f0-9]{64}$/);
    assert.strictEqual(parsed.changed, true);
  });

  test('reports unchanged after an idempotent install', async () => {
    await runMcpInstall({
      bundledEntryPath,
      version: '1.2.3',
      installedBy: 'cli',
      homeDirectory,
    });

    const output = await runMcpInstall({
      bundledEntryPath,
      version: '1.2.3',
      installedBy: 'cli',
      homeDirectory,
    });

    assert.match(output, /Changed: no/);
  });
});
