import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

import {
  addOperation,
  buildSnapshotFromProjects,
  discoverCoggitProjects,
  resolveOperation,
  statusOperation,
} from '@coggit/core'
import type {
  AddCognitionKind,
  AddOperationResult,
  CoggitProject,
  CoggitSnapshot,
  ResolveOperationResult,
  StatusOperationResult,
} from '@coggit/core'
import { createNodeCoggitServices } from '@coggit/runtime-node'

/** Deliberately empty: the workspace is NOT a config — it follows each calling session's cwd (see leaf). */
export interface Config {}

export const ConfigSchema: z<Config> = z.object({})

declare module '@deepseek-ai/cordis' {
  interface Context {
    coggit: CoggitService
  }
}

/** True when `workspaceRoot` has a `.coggit/config.yaml` — CogGit's per-project total config (source/cognition roots), not a per-node cognition doc. */
export function hasCoggitConfig(workspaceRoot: string): boolean {
  return existsSync(join(workspaceRoot, '.coggit', 'config.yaml'))
}

export async function discoverProjects(workspaceRoot: string): Promise<CoggitProject[]> {
  const services = createNodeCoggitServices({ workspacePath: workspaceRoot })
  return discoverCoggitProjects(services)
}

/** `ctx.coggit` facade over the CogGit SDK; projects are discovered and cached per workspace root. */
export class CoggitService extends Service {
  static Config = ConfigSchema

  private readonly projectsByRoot = new Map<string, Promise<CoggitProject[]>>()

  constructor(ctx: Context, _config: Config) {
    super(ctx, 'coggit')
  }

  private projects(workspaceRoot: string): Promise<CoggitProject[]> {
    let projects = this.projectsByRoot.get(workspaceRoot)
    if (projects === undefined) {
      projects = discoverProjects(workspaceRoot)
      this.projectsByRoot.set(workspaceRoot, projects)
    }
    return projects
  }

  async status(workspaceRoot: string, sourcePath: string): Promise<StatusOperationResult> {
    return statusOperation(await this.projects(workspaceRoot), sourcePath)
  }

  /**
   * Build a pre-built combined snapshot for one workspace root. Intended for a
   * single-turn batch (build once, then `statusWithSnapshot` per path); the
   * snapshot must NOT be reused across writes (reconcile-on-read, see upstream
   * `StatusOperationOptions.snapshot`).
   */
  async buildSnapshot(workspaceRoot: string): Promise<CoggitSnapshot> {
    return buildSnapshotFromProjects(await this.projects(workspaceRoot))
  }

  /** Like `status`, but resolves `sourcePath` against a pre-built snapshot. */
  async statusWithSnapshot(
    workspaceRoot: string,
    sourcePath: string,
    snapshot: CoggitSnapshot,
  ): Promise<StatusOperationResult> {
    return statusOperation(await this.projects(workspaceRoot), sourcePath, { snapshot })
  }

  async add(
    workspaceRoot: string,
    sourcePath: string,
    options?: { kind?: AddCognitionKind; overwrite?: boolean },
  ): Promise<AddOperationResult> {
    return addOperation(await this.projects(workspaceRoot), sourcePath, options)
  }

  async resolve(workspaceRoot: string, sourcePath: string): Promise<ResolveOperationResult> {
    return resolveOperation(await this.projects(workspaceRoot), sourcePath)
  }
}