import * as assert from 'node:assert';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  ensureUserMcpRuntime,
  getUserMcpLauncherPath,
} from './userMcpRuntime';

suite('user MCP runtime', () => {
  let tempDirectory: string;
  let homeDirectory: string;
  let bundledEntryPath: string;

  setup(async () => {
    tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'coggit-user-mcp-runtime-'));
    homeDirectory = path.join(tempDirectory, 'home');
    bundledEntryPath = path.join(tempDirectory, 'dist', 'mcp-stdio.js');
    await fs.mkdir(path.dirname(bundledEntryPath), { recursive: true });
    await fs.writeFile(bundledEntryPath, "process.stdout.write('runtime-v1');\n");
  });

  teardown(async () => {
    await fs.rm(tempDirectory, { recursive: true, force: true });
  });

  test('installs a stable launcher and content-addressed runtime', async () => {
    const installation = await ensureUserMcpRuntime({
      bundledEntryPath,
      version: '1.2.3',
      homeDirectory,
    });

    assert.strictEqual(installation.launcherPath, getUserMcpLauncherPath(homeDirectory));
    assert.match(installation.runtimeEntryPath, /runtimes[\\/]1\.2\.3-[a-f0-9]{12}[\\/]mcp-stdio\.js$/);
    assert.strictEqual(installation.activeVersion, '1.2.3');
    assert.strictEqual(installation.changed, true);
    assert.strictEqual(await runNode(installation.launcherPath), 'runtime-v1');

    const current = JSON.parse(
      await fs.readFile(path.join(homeDirectory, '.coggit', 'current.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.deepStrictEqual(current, {
      schemaVersion: 1,
      runtimeVersion: '1.2.3',
      entry: current.entry,
      integrity: current.integrity,
      installedBy: 'vscode-extension',
    });
    assert.strictEqual(typeof current.entry, 'string');
    assert.match(String(current.integrity), /^sha256:[a-f0-9]{64}$/);
  });

  test('is idempotent when the bundled runtime is unchanged', async () => {
    await ensureUserMcpRuntime({ bundledEntryPath, version: '1.2.3', homeDirectory });

    const installation = await ensureUserMcpRuntime({
      bundledEntryPath,
      version: '1.2.3',
      homeDirectory,
    });

    assert.strictEqual(installation.changed, false);
  });

  test('switches the current pointer when content changes at the same version', async () => {
    const first = await ensureUserMcpRuntime({ bundledEntryPath, version: '1.2.3', homeDirectory });
    await fs.writeFile(bundledEntryPath, "process.stdout.write('runtime-v2');\n");

    const second = await ensureUserMcpRuntime({ bundledEntryPath, version: '1.2.3', homeDirectory });

    assert.notStrictEqual(second.runtimeEntryPath, first.runtimeEntryPath);
    assert.strictEqual(await runNode(second.launcherPath), 'runtime-v2');
  });

  test('does not let an older extension downgrade the active runtime', async () => {
    await fs.writeFile(bundledEntryPath, "process.stdout.write('runtime-v2');\n");
    await ensureUserMcpRuntime({ bundledEntryPath, version: '2.0.0', homeDirectory });
    await fs.writeFile(bundledEntryPath, "process.stdout.write('runtime-v1');\n");

    const installation = await ensureUserMcpRuntime({
      bundledEntryPath,
      version: '1.9.0',
      homeDirectory,
    });

    assert.strictEqual(installation.activeVersion, '2.0.0');
    assert.strictEqual(await runNode(installation.launcherPath), 'runtime-v2');
  });

  test('repairs an invalid current descriptor', async () => {
    const coggitHome = path.join(homeDirectory, '.coggit');
    await fs.mkdir(coggitHome, { recursive: true });
    await fs.writeFile(path.join(coggitHome, 'current.json'), '{"entry":"../../outside.js"}\n');

    const installation = await ensureUserMcpRuntime({
      bundledEntryPath,
      version: '1.2.3',
      homeDirectory,
    });

    assert.strictEqual(await runNode(installation.launcherPath), 'runtime-v1');
  });

  test('rejects versions that cannot be used as managed directory names', async () => {
    await assert.rejects(
      ensureUserMcpRuntime({ bundledEntryPath, version: '../unsafe', homeDirectory }),
      /unsafe version/,
    );
  });
});

async function runNode(scriptPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [scriptPath], (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${error.message}\n${stderr}`));
        return;
      }
      resolve(stdout);
    });
  });
}
