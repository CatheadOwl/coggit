import { readdir } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { initProject } from '@coggit/core'
import { createNodeCoggitServices, pathToUriComponents } from '@coggit/runtime-node'

import { discoverProjects } from './service.js'

export interface CoggitInitStatus {
  initialized: boolean
  workspace: string
  configPath?: string
}

export interface CoggitSourceCandidate {
  name: string
}

export interface CoggitInitScope {
  /** Workspace directory addressed by the call; the browser passes the
   * current workspace path. Absent falls back to the server process cwd. */
  workspace?: string
}

export interface CoggitInitRequest {
  workspace?: string
  sourceRoot?: string
  cognitionRoot?: string
}

export interface CoggitInitResult extends CoggitInitStatus {
  sourceRoot: string
  cognitionRoot: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    coggitInit: CoggitInitService
  }
}

const DEFAULT_SOURCE_ROOT = 'src'
const DEFAULT_COGNITION_ROOT = 'src_cognition'

export class CoggitInitService extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'coggitInit')
  }

  /** Browser-supplied workspace path, else the server process cwd. */
  private workspaceOf(requested?: string): string {
    return resolve(requested ?? '.')
  }

  // Typert SRC discovery: unique identifier parameters without defaults — the wire may omit the request object entirely (see leaf).
  @Remote('status')
  async status(request?: CoggitInitScope): Promise<CoggitInitStatus> {
    const workspace = this.workspaceOf(request?.workspace)
    const projects = await discoverProjects(workspace)
    if (projects.length === 0) {
      return { initialized: false, workspace }
    }
    return {
      initialized: true,
      workspace,
      configPath: resolve(workspace, '.coggit', 'config.yaml'),
    }
  }

  @Remote('sourceCandidates')
  async sourceCandidates(request?: CoggitInitScope): Promise<CoggitSourceCandidate[]> {
    const workspace = this.workspaceOf(request?.workspace)
    const entries = await readdir(workspace, { withFileTypes: true })
    return entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .filter(name => !name.startsWith('.') && name !== 'node_modules')
      .sort((a, b) => a.localeCompare(b))
      .map(name => ({ name }))
  }

  @Remote('init')
  async init(request: CoggitInitRequest): Promise<CoggitInitResult> {
    const workspace = this.workspaceOf(request.workspace)
    const existing = await this.status({ workspace })
    if (existing.initialized) {
      throw new Error('CogGit is already initialized in this workspace.')
    }
    const sourceRoot = normalizeProjectRelativeRoot(request.sourceRoot, DEFAULT_SOURCE_ROOT)
    const cognitionRoot = normalizeProjectRelativeRoot(request.cognitionRoot, `${sourceRoot}_cognition`)
    const services = createNodeCoggitServices({ workspacePath: workspace })
    await initProject(services.fs, pathToUriComponents(workspace), { sourceRoot, cognitionRoot })
    return {
      initialized: true,
      workspace,
      configPath: resolve(workspace, '.coggit', 'config.yaml'),
      sourceRoot,
      cognitionRoot,
    }
  }
}

function normalizeProjectRelativeRoot(value: string | undefined, fallback: string): string {
  const normalized = (value ?? fallback).trim().replaceAll('\\', '/').replace(/^\.\/+/, '')
  if (normalized.length === 0) throw new Error('CogGit root fields cannot be empty.')
  if (isAbsolute(normalized) || normalized.split('/').some(part => part === '' || part === '.' || part === '..')) {
    throw new Error(`CogGit root must be a project-relative path: ${normalized}`)
  }
  return normalized
}
