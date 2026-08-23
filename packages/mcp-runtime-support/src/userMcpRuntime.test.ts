import * as assert from 'node:assert';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  ensureMcpRuntime,
  getMcpLauncherPath,
} from './userMcpRuntime';

suite('MCP runtime support', () => {
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
    const installation = await ensureMcpRuntime({
      bundledEntryPath,
      version: '1.2.3',
      installedBy: 'test',
      homeDirectory,
    });

    assert.strictEqual(installation.launcherPath, getMcpLauncherPath(homeDirectory));
    assert.match(installation.runtimeEntryPath, /runtimes[\\/]1\.2\.3-[a-f0-9]{12}[\\/]mcp-stdio\.js$/);
    assert.strictEqual(installation.activeVersion, '1.2.3');
    assert.match(installation.activeIntegrity, /^sha256:[a-f0-9]{64}$/);
    assert.strictEqual(installation.changed, true);
    assert.strictEqual(await runNode(installation.launcherPath), 'runtime-v1');

    const current = JSON.parse(
      await fs.readFile(path.join(homeDirectory, '.coggit', 'current.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.deepStrictEqual(current, {
      schemaVersion: 1,
      runtimeVersion: '1.2.3',
      entry: current.entry,
      integrity: installation.activeIntegrity,
      installedBy: 'test',
    });
    assert.strictEqual(typeof current.entry, 'string');
  });

  test('is idempotent when the bundled runtime is unchanged', async () => {
    await ensureMcpRuntime({
      bundledEntryPath,
      version: '1.2.3',
      installedBy: 'test',
      homeDirectory,
    });

    const installation = await ensureMcpRuntime({
      bundledEntryPath,
      version: '1.2.3',
      installedBy: 'test',
      homeDirectory,
    });

    assert.strictEqual(installation.changed, false);
  });

  test('switches the current pointer when content changes at the same version', async () => {
    const first = await ensureMcpRuntime({
      bundledEntryPath,
      version: '1.2.3',
      installedBy: 'test',
      homeDirectory,
    });
    await fs.writeFile(bundledEntryPath, "process.stdout.write('runtime-v2');\n");

    const second = await ensureMcpRuntime({
      bundledEntryPath,
      version: '1.2.3',
      installedBy: 'test',
      homeDirectory,
    });

    assert.notStrictEqual(second.runtimeEntryPath, first.runtimeEntryPath);
    assert.notStrictEqual(second.activeIntegrity, first.activeIntegrity);
    assert.strictEqual(await runNode(second.launcherPath), 'runtime-v2');
  });

  test('does not let an older extension downgrade the active runtime', async () => {
    await fs.writeFile(bundledEntryPath, "process.stdout.write('runtime-v2');\n");
    const newer = await ensureMcpRuntime({
      bundledEntryPath,
      version: '2.0.0',
      installedBy: 'test',
      homeDirectory,
    });
    await fs.writeFile(bundledEntryPath, "process.stdout.write('runtime-v1');\n");

    const installation = await ensureMcpRuntime({
      bundledEntryPath,
      version: '1.9.0',
      installedBy: 'test',
      homeDirectory,
    });

    assert.strictEqual(installation.activeVersion, '2.0.0');
    assert.strictEqual(installation.activeIntegrity, newer.activeIntegrity);
    assert.strictEqual(await runNode(installation.launcherPath), 'runtime-v2');
  });

  test('repairs an invalid current descriptor', async () => {
    const coggitHome = path.join(homeDirectory, '.coggit');
    await fs.mkdir(coggitHome, { recursive: true });
    await fs.writeFile(path.join(coggitHome, 'current.json'), '{"entry":"../../outside.js"}\n');

    const installation = await ensureMcpRuntime({
      bundledEntryPath,
      version: '1.2.3',
      installedBy: 'test',
      homeDirectory,
    });

    assert.strictEqual(await runNode(installation.launcherPath), 'runtime-v1');
  });

  test('repairs a missing launcher', async () => {
    const first = await ensureMcpRuntime({
      bundledEntryPath,
      version: '1.2.3',
      installedBy: 'test',
      homeDirectory,
    });
    await fs.rm(first.launcherPath);

    const second = await ensureMcpRuntime({
      bundledEntryPath,
      version: '1.2.3',
      installedBy: 'test',
      homeDirectory,
    });

    assert.strictEqual(second.changed, true);
    assert.strictEqual(await runNode(second.launcherPath), 'runtime-v1');
  });

  test('repairs a damaged non-empty launcher', async () => {
    const first = await ensureMcpRuntime({
      bundledEntryPath,
      version: '1.2.3',
      installedBy: 'test',
      homeDirectory,
    });
    await fs.writeFile(first.launcherPath, "process.stdout.write('damaged');\n");

    const second = await ensureMcpRuntime({
      bundledEntryPath,
      version: '1.2.3',
      installedBy: 'test',
      homeDirectory,
    });

    assert.strictEqual(second.changed, true);
    assert.strictEqual(await runNode(second.launcherPath), 'runtime-v1');
  });

  test('repairs a symlinked runtime entry instead of preserving it', async function () {
    if (process.platform === 'win32' && !await canCreateSymlink(tempDirectory)) {
      this.skip();
    }

    const first = await ensureMcpRuntime({
      bundledEntryPath,
      version: '1.2.3',
      installedBy: 'test',
      homeDirectory,
    });
    const escapedRuntime = path.join(tempDirectory, 'escaped-runtime.js');
    await fs.writeFile(escapedRuntime, "process.stdout.write('runtime-v1');\n");
    await fs.rm(first.runtimeEntryPath);
    await fs.symlink(escapedRuntime, first.runtimeEntryPath);

    assert.strictEqual((await fs.lstat(first.runtimeEntryPath)).isSymbolicLink(), true);

    const second = await ensureMcpRuntime({
      bundledEntryPath,
      version: '1.2.3',
      installedBy: 'test',
      homeDirectory,
    });

    assert.strictEqual(second.changed, true);
    assert.strictEqual((await fs.lstat(second.runtimeEntryPath)).isSymbolicLink(), false);
    assert.strictEqual(await runNode(second.launcherPath), 'runtime-v1');
  });

  test('launcher rejects descriptors with incomplete schema fields', async () => {
    const first = await ensureMcpRuntime({
      bundledEntryPath,
      version: '1.2.3',
      installedBy: 'test',
      homeDirectory,
    });
    const currentPath = path.join(homeDirectory, '.coggit', 'current.json');
    const current = JSON.parse(await fs.readFile(currentPath, 'utf8')) as Record<string, unknown>;
    delete current.integrity;
    await fs.writeFile(currentPath, `${JSON.stringify(current, null, 2)}\n`);

    await assert.rejects(
      runNode(first.launcherPath),
      /current\.json does not contain a supported CogGit runtime entry/,
    );
  });

  test('launcher rejects symlinked runtime entries that escape CogGit home', async function () {
    if (process.platform === 'win32' && !await canCreateSymlink(tempDirectory)) {
      this.skip();
    }

    const first = await ensureMcpRuntime({
      bundledEntryPath,
      version: '1.2.3',
      installedBy: 'test',
      homeDirectory,
    });
    const escapedRuntime = path.join(tempDirectory, 'escaped-runtime.js');
    await fs.writeFile(escapedRuntime, "process.stdout.write('escaped');\n");
    await fs.rm(first.runtimeEntryPath);
    await fs.symlink(escapedRuntime, first.runtimeEntryPath);

    await assert.rejects(
      runNode(first.launcherPath),
      /current\.json points outside the CogGit home directory/,
    );
  });

  test('rejects versions that cannot be used as managed directory names', async () => {
    await assert.rejects(
      ensureMcpRuntime({
        bundledEntryPath,
        version: '../unsafe',
        installedBy: 'test',
        homeDirectory,
      }),
      /unsafe version/,
    );
  });

  test('requires caller identity', async () => {
    await assert.rejects(
      ensureMcpRuntime({
        bundledEntryPath,
        version: '1.2.3',
        installedBy: '',
        homeDirectory,
      }),
      /installedBy/,
    );
  });

  test('reports a missing bundle as an install failure', async () => {
    await assert.rejects(
      ensureMcpRuntime({
        bundledEntryPath: path.join(tempDirectory, 'missing', 'mcp-stdio.js'),
        version: '1.2.3',
        installedBy: 'test',
        homeDirectory,
      }),
      /Cannot read CogGit MCP runtime bundle/,
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

async function canCreateSymlink(tempDirectory: string): Promise<boolean> {
  const target = path.join(tempDirectory, 'symlink-target.js');
  const link = path.join(tempDirectory, 'symlink-link.js');
  await fs.writeFile(target, '');
  try {
    await fs.symlink(target, link);
    return true;
  } catch {
    return false;
  } finally {
    await fs.rm(link, { force: true });
  }
}
