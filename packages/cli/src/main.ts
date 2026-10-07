import { Command, InvalidArgumentError, Option } from 'commander';

import { createNodeCoggitServices } from '@coggit/runtime-node';
import { discoverCoggitProjects, type AddCognitionKind, type CognitionKind, type CoggitSystemPromptKind } from '@coggit/core';
import type { SnapshotScope } from '@coggit/format';
import { runAdd } from './add';
import { runHandbook } from './handbook';
import { runInit, type InitOptions } from './init';
import { runInstructions, type InstructionsFormat } from './instructions';
import { resolveBundledMcpEntryPath, runMcpInstall } from './mcpInstall';
import { runOrphans } from './orphans';
import { runResolve } from './resolve';
import { runSnapshot } from './snapshot';
import { runStatus, UserFacingError } from './status';
import { openStrictWatchProject, startWatchSession } from './watch';

declare const __COGGIT_PACKAGE_VERSION__: string | undefined;

void main(process.argv);

async function main(argv: string[]): Promise<void> {
  const program = createProgram(async (command) => {
    const services = createNodeCoggitServices({ configDiscovery: 'nearest' });
    const projects = await discoverCoggitProjects(services);
    const output = await command(projects);
    console.log(output);
  });

  try {
    await program.parseAsync(argv);
  } catch (error) {
    if (error instanceof UserFacingError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    if (error instanceof InvalidArgumentError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }

    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}

function createProgram(
  runWithProjects: (
    command: (projects: Awaited<ReturnType<typeof discoverCoggitProjects>>) => Promise<string>,
  ) => Promise<void>,
): Command {
  const program = new Command();

  program
    .name('coggit')
    .version(packageVersion(), '-v, --version', 'output the CLI version')
    .showHelpAfterError()
    .showSuggestionAfterError(false);

  program
    .command('status')
    .argument('[path]')
    .action(async (sourcePath: string | undefined) => {
      await runWithProjects((projects) => runStatus(projects, sourcePath));
    });

  program
    .command('init')
    .description('Initialise a new CogGit project at the given path.')
    .argument('[path]', 'project root (defaults to the current directory)')
    .option('--source-root <dir>', 'source root directory (default: src)')
    .option('--cognition-root <dir>', 'cognition root directory (default: <source-root>_cognition)')
    .action(async (targetPath: string | undefined, options: InitOptions) => {
      const services = createNodeCoggitServices();
      const output = await runInit(services.fs, targetPath ?? '.', {
        sourceRoot: options.sourceRoot,
        cognitionRoot: options.cognitionRoot,
      });
      console.log(output);
    });

  const mcp = program
    .command('mcp')
    .description('Manage CogGit MCP runtime support.');

  mcp
    .command('install')
    .description('Install or repair the user-level CogGit MCP runtime launcher.')
    .option('-j, --json', 'output structured installation JSON instead of text')
    .action(async (options: McpInstallCommandOptions) => {
      const output = await runMcpInstall({
        bundledEntryPath: resolveBundledMcpEntryPath(__dirname),
        version: packageVersion(),
        installedBy: 'cli',
        json: options.json,
      });
      console.log(output);
    });

  program
    .command('snapshot')
    .argument('[path]')
    .option('--scope <scope>', 'filter nodes: all, tracked, untracked, issues', parseSnapshotScope)
    .option('--max-depth <n>', 'maximum tree depth below the selected source path', parseMaxDepth)
    .option('-j, --json', 'output structured TreeProjectionNode JSON instead of text')
    .action(async (sourcePath: string | undefined, options: SnapshotOptions) => {
      await runWithProjects((projects) => runSnapshot(projects, sourcePath, {
        scope: options.scope,
        maxDepth: options.maxDepth,
        json: options.json,
      }));
    });

  program
    .command('orphans')
    .description('List registry-tracked cognition files whose paired source path no longer exists.')
    .option('-j, --json', 'output structured orphaned cognition JSON instead of text')
    .action(async (options: OrphansOptions) => {
      await runWithProjects((projects) => runOrphans(projects, {
        json: options.json,
      }));
    });

  program
    .command('add')
    .argument('<path>')
    .option('--kind <kind>', 'cognition kind: auto, leaf, skeleton', parseAddCognitionKind, 'auto')
    .option('--overwrite', 'replace existing cognition content', false)
    .action(async (sourcePath: string, options: AddOptions) => {
      await runWithProjects((projects) => runAdd(
        projects,
        sourcePath,
        options.kind,
        options.overwrite,
      ));
    });

  program
    .command('resolve')
    .argument('<path>')
    .action(async (sourcePath: string) => {
      await runWithProjects((projects) => runResolve(projects, sourcePath));
    });

  program
    .command('handbook')
    .argument('[kind]', 'handbook kind: leaf, skeleton, or deprecated all', parseHandbookKind, 'all')
    .action((kind: CognitionKind | 'all') => {
      console.log(runHandbook(kind));
    });

  program
    .command('instructions')
    .description('Print the CogGit agent guidance for CLI hosts (stdout only; compose with host flags or paste into AGENTS.md).')
    .argument('[kind]', 'system prompt kind: minimal, standard (synonym of --kind)', parsePositionalSystemPromptKind)
    .option('--kind <kind>', 'system prompt kind: minimal, standard', parseSystemPromptKind, 'minimal')
    .option('--format <format>', 'output shape: raw or block', parseInstructionsFormat, 'raw')
    .action((kind: CoggitSystemPromptKind | undefined, options: InstructionsOptions, command: Command) => {
      // --kind defaults to 'minimal'; the value source tells an explicit --kind apart from that default.
      if (kind !== undefined && command.getOptionValueSource('kind') === 'cli' && kind !== options.kind) {
        throw new InvalidArgumentError(`conflicting kinds: positional '${kind}' and --kind '${options.kind}'.`);
      }
      console.log(runInstructions(kind ?? options.kind, options.format));
    });

  program
    .command('watch')
    .description('Watch source, cognition, and config changes and emit observations.')
    .argument('[path]', 'initialized project root (defaults to the current directory)')
    .option('-j, --json', 'emit JSON Lines (one observation result per line)')
    .action(async (targetPath: string | undefined, options: WatchOptions) => {
      const services = createNodeCoggitServices();
      const projects = [await openStrictWatchProject(services, targetPath ?? '.')];
      const session = await startWatchSession(projects, { json: options.json }, (line) => console.log(line));
      await new Promise<void>((resolve, reject) => {
        let cleanup = () => undefined;
        const finish = (fn: () => Promise<void>) => {
          cleanup();
          void fn().then(resolve, reject);
        };
        const shutdown = () => finish(() => session.dispose());
        const complete = () => finish(async () => undefined);
        cleanup = () => {
          process.off('SIGINT', shutdown);
          process.off('SIGTERM', shutdown);
        };
        process.once('SIGINT', shutdown);
        process.once('SIGTERM', shutdown);
        void session.done.then(complete, reject);
      });
    });

  return program;
}

interface SnapshotOptions {
  scope?: SnapshotScope;
  maxDepth?: number;
  json?: boolean;
}

interface OrphansOptions {
  json?: boolean;
}

interface WatchOptions {
  json?: boolean;
}

interface McpInstallCommandOptions {
  json?: boolean;
}

interface InstructionsOptions {
  kind: CoggitSystemPromptKind;
  format: InstructionsFormat;
}

interface AddOptions {
  kind: AddCognitionKind;
  overwrite: boolean;
}

function parseSnapshotScope(value: string): SnapshotScope {
  if (value === 'all' || value === 'tracked' || value === 'untracked' || value === 'issues') {
    return value;
  }
  throw new InvalidArgumentError('--scope must be one of: all, tracked, untracked, issues.');
}

function parseMaxDepth(value: string): number {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed >= 0) {
    return parsed;
  }
  throw new InvalidArgumentError('--max-depth must be a non-negative integer.');
}

function parseAddCognitionKind(value: string): AddCognitionKind {
  if (value === 'auto' || value === 'leaf' || value === 'skeleton') {
    return value;
  }
  throw new InvalidArgumentError('--kind must be one of: auto, leaf, skeleton.');
}

function parseHandbookKind(value: string): CognitionKind | 'all' {
  if (value === 'all' || value === 'leaf' || value === 'skeleton') {
    return value;
  }
  throw new InvalidArgumentError('handbook kind must be one of: all, leaf, skeleton.');
}

function parseSystemPromptKind(value: string): CoggitSystemPromptKind {
  if (value === 'minimal' || value === 'standard') {
    return value;
  }
  throw new InvalidArgumentError('--kind must be one of: minimal, standard.');
}

function parsePositionalSystemPromptKind(value: string): CoggitSystemPromptKind {
  if (value === 'minimal' || value === 'standard') {
    return value;
  }
  throw new InvalidArgumentError('kind argument must be one of: minimal, standard.');
}

function parseInstructionsFormat(value: string): InstructionsFormat {
  if (value === 'raw' || value === 'block') {
    return value;
  }
  throw new InvalidArgumentError('--format must be one of: raw, block.');
}

function packageVersion(): string {
  return typeof __COGGIT_PACKAGE_VERSION__ === 'string'
    ? __COGGIT_PACKAGE_VERSION__
    : '0.0.0-development';
}
