// Shared test helpers for the coggit adapter suite.
// These tests exercise the BUILT `lib/` artifacts (see README Development),
// never `src/`, so `node --test` runs without the dsh host's `@deepseek-ai/*`
// junctions or any Cordis process.

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Absolute path to the plugin root (`.../dsh-plugin-dev/coggit`), independent of the test runner cwd. */
export const pluginRoot = fileURLToPath(new URL('..', import.meta.url))

/** Absolute path to the compiled lib directory. */
export const libRoot = join(pluginRoot, 'lib')

/** Resolve a compiled ESM module under `lib/types/` to its file URL string. */
export function fromLib(rel) {
  return new URL(join('lib', 'types', rel) + '.js', new URL('file://' + pluginRoot.replace(/\\/g, '/') + '/')).href
}

/** Create a fresh temp directory for one fixture. Deleted on `after` teardown. */
export async function makeTempDir(prefix) {
  return mkdtemp(join(tmpdir(), prefix + '-'))
}

/** Remove a temp fixture tree. */
export async function removeTempDir(dir) {
  await rm(dir, { recursive: true, force: true })
}

/**
 * Create a minimal, initialized CogGit project at `root`:
 *
 *   <root>/.coggit/config.yaml   (source_root: src / cognition_root: src_cognition)
 *   <root>/src/                  (source root, empty)
 *   <root>/src_cognition/        (cognition root, seeded README.md)
 *
 * Mirrors `@coggit/core`'s `initProject` on-disk layout without importing the
 * SDK's FileSystem abstraction.
 */
export async function createInitializedProject(root, { sourceRoot = 'src', cognitionRoot = 'src_cognition' } = {}) {
  const { mkdir, writeFile } = await import('node:fs/promises')
  const configDir = join(root, '.coggit')
  const configPath = join(configDir, 'config.yaml')
  const sourceDir = join(root, sourceRoot)
  const cognitionDir = join(root, cognitionRoot)
  const readmePath = join(cognitionDir, 'README.md')

  await mkdir(configDir, { recursive: true })
  await mkdir(sourceDir, { recursive: true })
  await mkdir(cognitionDir, { recursive: true })

  const yaml = [
    '# Coggit project configuration',
    `source_root: "${sourceRoot}"`,
    `cognition_root: "${cognitionRoot}"`,
    '',
  ].join('\n')
  await writeFile(configPath, yaml, 'utf8')
  await writeFile(readmePath, '# Cognition layer\n', 'utf8')

  return { root, sourceRoot, cognitionRoot, configPath, sourceDir, cognitionDir }
}
