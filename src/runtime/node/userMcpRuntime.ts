import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

const CURRENT_SCHEMA_VERSION = 1;
const COGGIT_HOME_DIRECTORY = '.coggit';
const MCP_LAUNCHER_RELATIVE_PATH = path.join('bin', 'coggit-mcp.js');

const MCP_LAUNCHER_SOURCE = `#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

try {
  const coggitHome = path.resolve(__dirname, '..');
  const currentPath = path.join(coggitHome, 'current.json');
  const current = JSON.parse(fs.readFileSync(currentPath, 'utf8'));
  if (current.schemaVersion !== 1 || typeof current.entry !== 'string') {
    throw new Error('current.json does not contain a supported CogGit runtime entry.');
  }

  const entryPath = path.resolve(coggitHome, current.entry);
  const relativeEntry = path.relative(coggitHome, entryPath);
  if (relativeEntry === '' || relativeEntry === '..' || relativeEntry.startsWith('..' + path.sep) || path.isAbsolute(relativeEntry)) {
    throw new Error('current.json points outside the CogGit home directory.');
  }

  require(entryPath);
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write('[coggit-mcp] Failed to start the active runtime: ' + message + '\\n');
  process.exitCode = 1;
}
`;

interface CurrentRuntimeDescriptor {
  schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  runtimeVersion: string;
  entry: string;
  integrity: string;
  installedBy: string;
}

export interface EnsureUserMcpRuntimeOptions {
  bundledEntryPath: string;
  version: string;
  homeDirectory?: string;
  installedBy?: string;
}

export interface UserMcpRuntimeInstallation {
  launcherPath: string;
  runtimeEntryPath: string;
  activeVersion: string;
  changed: boolean;
}

export function getUserMcpLauncherPath(homeDirectory = os.homedir()): string {
  return path.join(homeDirectory, COGGIT_HOME_DIRECTORY, MCP_LAUNCHER_RELATIVE_PATH);
}

export async function ensureUserMcpRuntime(
  options: EnsureUserMcpRuntimeOptions,
): Promise<UserMcpRuntimeInstallation> {
  assertSafeVersion(options.version);

  const homeDirectory = options.homeDirectory ?? os.homedir();
  const coggitHome = path.join(homeDirectory, COGGIT_HOME_DIRECTORY);
  const runtimesDirectory = path.join(coggitHome, 'runtimes');
  const launcherPath = getUserMcpLauncherPath(homeDirectory);
  const currentPath = path.join(coggitHome, 'current.json');

  await fs.mkdir(runtimesDirectory, { recursive: true });
  await fs.mkdir(path.dirname(launcherPath), { recursive: true });

  const current = await readCurrentRuntime(currentPath, coggitHome);
  if (
    current
    && compareSemanticVersions(current.descriptor.runtimeVersion, options.version) > 0
    && await fileMatchesIntegrity(current.entryPath, current.descriptor.integrity)
  ) {
    const launcherChanged = await ensureFileExists(launcherPath, MCP_LAUNCHER_SOURCE);
    return {
      launcherPath,
      runtimeEntryPath: current.entryPath,
      activeVersion: current.descriptor.runtimeVersion,
      changed: launcherChanged,
    };
  }

  const bundledEntry = await fs.readFile(options.bundledEntryPath);
  const digest = createHash('sha256').update(bundledEntry).digest('hex');
  const runtimeDirectoryName = `${options.version}-${digest.slice(0, 12)}`;
  const runtimeEntryPath = path.join(runtimesDirectory, runtimeDirectoryName, 'mcp-stdio.js');
  const runtimeChanged = await ensureFileContent(runtimeEntryPath, bundledEntry);

  const descriptor: CurrentRuntimeDescriptor = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    runtimeVersion: options.version,
    entry: toPortableRelativePath(coggitHome, runtimeEntryPath),
    integrity: `sha256:${digest}`,
    installedBy: options.installedBy ?? 'vscode-extension',
  };
  const currentChanged = await ensureFileContent(
    currentPath,
    `${JSON.stringify(descriptor, null, 2)}\n`,
  );
  const launcherChanged = await ensureFileContent(launcherPath, MCP_LAUNCHER_SOURCE);

  return {
    launcherPath,
    runtimeEntryPath,
    activeVersion: options.version,
    changed: runtimeChanged || currentChanged || launcherChanged,
  };
}

async function readCurrentRuntime(
  currentPath: string,
  coggitHome: string,
): Promise<{ descriptor: CurrentRuntimeDescriptor; entryPath: string } | undefined> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(currentPath, 'utf8')) as unknown;
  } catch {
    return undefined;
  }

  if (!isCurrentRuntimeDescriptor(parsed)) {
    return undefined;
  }

  const entryPath = resolveContainedPath(coggitHome, parsed.entry);
  if (!entryPath) {
    return undefined;
  }

  return { descriptor: parsed, entryPath };
}

function isCurrentRuntimeDescriptor(value: unknown): value is CurrentRuntimeDescriptor {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return candidate.schemaVersion === CURRENT_SCHEMA_VERSION
    && typeof candidate.runtimeVersion === 'string'
    && typeof candidate.entry === 'string'
    && typeof candidate.integrity === 'string'
    && typeof candidate.installedBy === 'string';
}

async function ensureFileContent(
  destination: string,
  content: string | Uint8Array,
): Promise<boolean> {
  const desired = typeof content === 'string' ? Buffer.from(content) : Buffer.from(content);
  try {
    const existing = await fs.readFile(destination);
    if (existing.equals(desired)) {
      return false;
    }
  } catch {
    // Missing or unreadable managed files are repaired below.
  }

  await fs.mkdir(path.dirname(destination), { recursive: true });
  await replaceFileAtomically(destination, desired);
  return true;
}

async function ensureFileExists(destination: string, content: string): Promise<boolean> {
  try {
    const stat = await fs.stat(destination);
    if (stat.isFile() && stat.size > 0) {
      return false;
    }
  } catch {
    // The missing managed launcher is restored below.
  }

  await fs.mkdir(path.dirname(destination), { recursive: true });
  await replaceFileAtomically(destination, Buffer.from(content));
  return true;
}

async function replaceFileAtomically(destination: string, content: Uint8Array): Promise<void> {
  const temporaryPath = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  const backupPath = `${destination}.${process.pid}.${randomUUID()}.bak`;
  await fs.writeFile(temporaryPath, content);

  try {
    try {
      await fs.rename(temporaryPath, destination);
      return;
    } catch (error) {
      if (!hasCode(error, 'EEXIST') && !hasCode(error, 'EPERM')) {
        throw error;
      }
    }

    let movedExisting = false;
    try {
      await fs.rename(destination, backupPath);
      movedExisting = true;
    } catch (error) {
      if (!hasCode(error, 'ENOENT')) {
        throw error;
      }
    }

    try {
      await fs.rename(temporaryPath, destination);
    } catch (error) {
      if (movedExisting) {
        await fs.rename(backupPath, destination);
      }
      throw error;
    }

    if (movedExisting) {
      await fs.rm(backupPath, { force: true }).catch(() => undefined);
    }
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

function resolveContainedPath(root: string, relativePath: string): string | undefined {
  if (path.isAbsolute(relativePath)) {
    return undefined;
  }

  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);
  if (
    relative === ''
    || relative === '..'
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) {
    return undefined;
  }
  return resolved;
}

function toPortableRelativePath(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join('/');
}

async function fileMatchesIntegrity(filePath: string, integrity: string): Promise<boolean> {
  const match = /^sha256:([a-f0-9]{64})$/.exec(integrity);
  if (!match) {
    return false;
  }

  try {
    const content = await fs.readFile(filePath);
    return createHash('sha256').update(content).digest('hex') === match[1];
  } catch {
    return false;
  }
}

function assertSafeVersion(version: string): void {
  if (!/^[0-9A-Za-z][0-9A-Za-z._+-]*$/.test(version)) {
    throw new Error(`Cannot install CogGit MCP runtime with unsafe version: ${version}`);
  }
}

function compareSemanticVersions(left: string, right: string): number {
  const leftVersion = parseSemanticVersion(left);
  const rightVersion = parseSemanticVersion(right);
  if (!leftVersion || !rightVersion) {
    return 0;
  }

  for (let index = 0; index < 3; index++) {
    const difference = leftVersion.core[index] - rightVersion.core[index];
    if (difference !== 0) {
      return Math.sign(difference);
    }
  }

  if (!leftVersion.prerelease && !rightVersion.prerelease) {
    return 0;
  }
  if (!leftVersion.prerelease) {
    return 1;
  }
  if (!rightVersion.prerelease) {
    return -1;
  }

  const length = Math.max(leftVersion.prerelease.length, rightVersion.prerelease.length);
  for (let index = 0; index < length; index++) {
    const leftPart = leftVersion.prerelease[index];
    const rightPart = rightVersion.prerelease[index];
    if (leftPart === undefined) {
      return -1;
    }
    if (rightPart === undefined) {
      return 1;
    }
    if (leftPart === rightPart) {
      continue;
    }

    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) {
      return Number(leftPart) < Number(rightPart) ? -1 : 1;
    }
    if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1;
    }
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

function parseSemanticVersion(
  version: string,
): { core: [number, number, number]; prerelease?: string[] } | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version);
  if (!match) {
    return undefined;
  }

  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    ...(match[4] ? { prerelease: match[4].split('.') } : {}),
  };
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === code;
}
