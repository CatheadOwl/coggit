import { Command, InvalidArgumentError, Option } from 'commander';

import { createNodeCoggitServices } from '../runtime/node';
import { discoverCoggitProjects, type AddCognitionKind, type CognitionKind } from '../core';
import type { SnapshotScope } from '../render';
import { runAdd } from './add';
import { runHandbook } from './handbook';
import { runOrphans } from './orphans';
import { runResolve } from './resolve';
import { runRoutes, type RoutesFormat } from './routes';
import { runSnapshot } from './snapshot';
import { runStatus, type StatusMode, UserFacingError } from './status';

void main(process.argv);

async function main(argv: string[]): Promise<void> {
  const program = createProgram(async (command) => {
    const services = createNodeCoggitServices();
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
    .showHelpAfterError()
    .showSuggestionAfterError(false);

  program
    .command('status')
    .argument('[path]')
    .addOption(new Option('--own', 'show only the selected node status').conflicts('subtree'))
    .addOption(new Option('--subtree', 'show subtree issue details').conflicts('own'))
    .action(async (sourcePath: string | undefined, options: StatusOptions) => {
      await runWithProjects((projects) => runStatus(projects, sourcePath, statusMode(options)));
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
    .command('routes')
    .argument('[path]')
    .option('--depth <n>', 'maximum route tree depth below the selected source path', parseMaxDepth)
    .option('--format <format>', 'output shape: flat or tree', parseRoutesFormat, 'flat')
    .option('-j, --json', 'output route projection JSON instead of text')
    .action(async (sourcePath: string | undefined, options: RoutesOptions) => {
      await runWithProjects((projects) => runRoutes(projects, sourcePath, {
        depth: options.depth,
        format: options.format,
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

  return program;
}

interface StatusOptions {
  own?: boolean;
  subtree?: boolean;
}

interface SnapshotOptions {
  scope?: SnapshotScope;
  maxDepth?: number;
  json?: boolean;
}

interface RoutesOptions {
  depth?: number;
  format?: RoutesFormat;
  json?: boolean;
}

interface OrphansOptions {
  json?: boolean;
}

interface AddOptions {
  kind: AddCognitionKind;
  overwrite: boolean;
}

function statusMode(options: StatusOptions): StatusMode {
  if (options.own) {
    return 'own';
  }
  if (options.subtree) {
    return 'subtree';
  }
  return 'aggregate';
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

function parseRoutesFormat(value: string): RoutesFormat {
  if (value === 'flat' || value === 'tree') {
    return value;
  }
  throw new InvalidArgumentError('--format must be one of: flat, tree.');
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
