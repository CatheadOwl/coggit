#!/usr/bin/env node
/**
 * Rebuild the machine-local `@deepseek-ai` resolution layer for this package.
 *
 * All `@deepseek-ai/*` imports are host-provided peers. Node resolves this
 * package from its real directory (profile installs use link: semantics), so
 * the peers need a local junction into the dsh profile install closure. The
 * junction is machine-local and gitignored; this script recreates it after a
 * clean checkout. Cross-platform: junction on Windows, symlink elsewhere.
 */
import { rmSync, symlinkSync, mkdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'

const scopeDir = join(resolve('.'), 'node_modules', '@deepseek-ai')
const target = join(homedir(), '.dsh', 'profiles', 'node_modules', '@deepseek-ai')

if (!existsSync(target)) {
  console.error(`[relink-dsh-peers] target missing: ${target}`)
  console.error('Start a dsh profile once (or run a dsh server) so the profile node_modules closure is installed, then re-run.')
  process.exit(1)
}

rmSync(scopeDir, { recursive: true, force: true })
mkdirSync(join(resolve('.'), 'node_modules'), { recursive: true })
if (process.platform === 'win32') {
  // junctions need no admin on Windows
  symlinkSync(target, scopeDir, 'junction')
} else {
  symlinkSync(target, scopeDir, 'dir')
}
console.log(`[relink-dsh-peers] ${scopeDir} -> ${target}`)
