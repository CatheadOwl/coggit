import * as assert from 'node:assert';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

suite('CLI main', () => {
  let tempDirectory: string;
  let cwd: string;
  let homeDirectory: string;
  let outCliPath: string;
  let outMcpEntryPath: string;

  setup(async () => {
    tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'coggit-cli-main-'));
    cwd = path.join(tempDirectory, 'cwd');
    homeDirectory = path.join(tempDirectory, 'home');
    await fs.mkdir(cwd, { recursive: true });
    outCliPath = path.resolve(__dirname, 'main.js');
    outMcpEntryPath = path.resolve(__dirname, 'mcp-stdio.js');
    await fs.writeFile(outMcpEntryPath, "process.stdout.write('runtime');\n");
  });

  teardown(async () => {
    await fs.rm(outMcpEntryPath, { force: true });
    await fs.rm(tempDirectory, { recursive: true, force: true });
  });

  test('runs mcp install from outside a CogGit project', async () => {
    const first = await runCli(['mcp', 'install', '--json'], cwd, homeDirectory);
    const parsed = JSON.parse(first.stdout) as Record<string, unknown>;

    assert.strictEqual(first.stderr, '');
    assert.strictEqual(parsed.activeVersion, '0.0.0-development');
    assert.match(String(parsed.activeIntegrity), /^sha256:[a-f0-9]{64}$/);
    assert.strictEqual(parsed.changed, true);

    const second = await runCli(['mcp', 'install'], cwd, homeDirectory);
    assert.strictEqual(second.stderr, '');
    assert.match(second.stdout, /CogGit MCP launcher:/);
    assert.match(second.stdout, /Changed: no/);
  });

  async function runCli(
    args: readonly string[],
    workingDirectory: string,
    userProfile: string,
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      execFile(
        process.execPath,
        [outCliPath, ...args],
        {
          cwd: workingDirectory,
          env: {
            ...process.env,
            HOME: userProfile,
            USERPROFILE: userProfile,
          },
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(`${error.message}\n${stderr}`));
            return;
          }
          resolve({ stdout, stderr });
        },
      );
    });
  }
});
