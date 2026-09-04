/**
 * Shared case fixture: seed a real CogGit project inside an eval workspace
 * through the SDK's own init path (the same call the init service uses), so
 * `coggit_add` cases exercise a succeeding write surface instead of the
 * `no-projects` error branch.
 */
import { writeFile, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { initProject } from '@coggit/core'
import { createNodeCoggitServices, pathToUriComponents } from '@coggit/runtime-node'

/** Initialize `.coggit/` at the workspace root with `src` -> `src_cognition`. */
export async function seedProject(workspace) {
  const services = createNodeCoggitServices({ workspacePath: workspace })
  await initProject(services.fs, pathToUriComponents(workspace), {
    sourceRoot: 'src',
    cognitionRoot: 'src_cognition',
  })
  await mkdir(join(workspace, 'src'), { recursive: true })
  await writeFile(join(workspace, 'src', 'example.ts'), 'export const value = 42\n')
}

/** Recursively collect file names under `dir` (empty when absent). */
async function fileNames(dir, out = []) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) await fileNames(path, out)
    else out.push(entry.name)
  }
  return out
}

/**
 * Assert a successful add wrote a cognition document: a non-README markdown
 * file under the cognition root and a maintained registry.
 */
export async function assertCognitionWritten(workspace) {
  const cognitionFiles = await fileNames(join(workspace, 'src_cognition'))
  const docs = cognitionFiles.filter(name => name.endsWith('.md') && name !== 'README.md')
  if (docs.length === 0) {
    throw new Error(`no cognition document under src_cognition/ (found: ${JSON.stringify(cognitionFiles)})`)
  }
  const registry = await fileNames(join(workspace, '.coggit'))
  if (!registry.includes('registry.json')) {
    throw new Error(`no .coggit/registry.json after add (found: ${JSON.stringify(registry)})`)
  }
}
