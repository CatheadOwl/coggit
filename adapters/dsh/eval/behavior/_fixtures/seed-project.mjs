/**
 * Shared case fixture: seed a real CogGit project inside an eval workspace
 * through the SDK's own init path (the same call the init service uses), so
 * `coggit_add` cases exercise a succeeding write surface instead of the
 * `no-projects` error branch.
 */
import { writeFile, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { addOperation, discoverCoggitProjects, initProject, statusOperation } from '@coggit/core'
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

/**
 * Seed a fresh cognition pair for `src/example.ts` through the SDK's own add
 * path, so touch-lane cases start from a present, fresh cognition document
 * (the enricher's never→fresh branch) without a model-side `coggit_add` call.
 */
export async function seedFreshCognition(workspace) {
  const services = createNodeCoggitServices({ workspacePath: workspace })
  const projects = await discoverCoggitProjects(services)
  await addOperation(projects, 'src/example.ts')
  // Materialize the lazy acceptance evidence: the registry's accepted-pair
  // entry is resolved against the file content on the first status read, so
  // a source rewrite BEFORE this point is simply folded into the acceptance
  // (the pair reads fresh). Stale-seeding below relies on the acceptance
  // being on record first.
  await statusOperation(projects, 'src/example.ts')
}

/**
 * Seed a stale cognition pair for `src/example.ts`: fresh add first, then an
 * out-of-band source rewrite (plain fs write, no tool) so the pair reads
 * stale — the enricher's stale branch with the `(stale)` meta suffix, without
 * any model-side edit.
 */
export async function seedStaleCognition(workspace) {
  await seedFreshCognition(workspace)
  await writeFile(join(workspace, 'src', 'example.ts'), 'export const value = 43\n')
}

/**
 * Seed a CONVENTION-BEARING cognition pair for `src/example.ts`: the mirror
 * carries a design invariant the v2 task's requested edit violates (`value`
 * must stay even). Written between `addOperation` and the first
 * `statusOperation` so the acceptance folds it in and the pair reads fresh —
 * the cognition-gated case isolates the copy effect on decision quality, not
 * the `(stale)` marker.
 */
export async function seedConventionCognition(workspace) {
  await seedProject(workspace)
  const services = createNodeCoggitServices({ workspacePath: workspace })
  const projects = await discoverCoggitProjects(services)
  await addOperation(projects, 'src/example.ts')
  await writeFile(
    join(workspace, 'src_cognition', 'example.ts.md'),
    [
      '# example.ts',
      '',
      '## Invariants',
      '',
      '- `value` must stay even — the downstream validator rejects odd numbers.',
      '- Any change to `value` is a release decision: pick the nearest even number and say so.',
      '',
    ].join('\n'),
  )
  await statusOperation(projects, 'src/example.ts')
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
