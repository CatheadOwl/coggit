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

  test('instructions accepts a positional kind synonym and rejects conflicts', async () => {
    const positional = await runCli(['instructions', 'standard'], cwd, homeDirectory);
    const option = await runCli(['instructions', '--kind', 'standard'], cwd, homeDirectory);
    const defaultForm = await runCli(['instructions'], cwd, homeDirectory);
    assert.strictEqual(positional.stderr, '');
    assert.strictEqual(positional.stdout, option.stdout);
    assert.notStrictEqual(positional.stdout, defaultForm.stdout);

    const block = await runCli(['instructions', 'standard', '--format', 'block'], cwd, homeDirectory);
    assert.match(block.stdout, /<!-- coggit:begin system-prompt kind=standard /);

    const agreeing = await runCli(['instructions', 'minimal', '--kind', 'minimal'], cwd, homeDirectory);
    assert.strictEqual(agreeing.stdout, defaultForm.stdout);

    const conflict = await runCliCapture(['instructions', 'standard', '--kind', 'minimal'], cwd, homeDirectory);
    assert.strictEqual(conflict.code, 1);
    assert.match(conflict.stderr, /conflicting kinds/);

    const invalid = await runCliCapture(['instructions', 'bogus'], cwd, homeDirectory);
    assert.strictEqual(invalid.code, 1);
    assert.match(invalid.stderr, /must be one of: minimal, standard/);
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

  async function runCliCapture(
    args: readonly string[],
    workingDirectory: string,
    userProfile: string,
  ): Promise<{ code: number; stdout: string; stderr: string }> {
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
          if (error && typeof error.code === 'number') {
            resolve({ code: error.code, stdout, stderr });
            return;
          }
          if (error) {
            reject(new Error(`${error.message}\n${stderr}`));
            return;
          }
          resolve({ code: 0, stdout, stderr });
        },
      );
    });
  }
});
