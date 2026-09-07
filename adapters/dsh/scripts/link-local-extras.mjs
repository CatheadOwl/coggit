/**
 * Opt-in local-resolution channel for `@catheadowl/dsh-extras` (mirror of the
 * relink-dsh-peers pattern: a committed script, a machine-local junction).
 *
 * Re-points this package's node_modules entry for `@catheadowl/dsh-extras`
 * at a local checkout, so unpublished changes there are visible to this
 * package's own imports and tests. Install-time registry resolution stays
 * untouched — any later `pnpm install` restores the registry layout, so this
 * is a reversible dev affordance, not an override (a `pnpm-workspace.yaml`
 * link override would break installs on machines without the checkout).
 *
 * Usage (the checkout path is required — where a local checkout lives is
 * machine-local knowledge this script deliberately does not embed):
 *
 *   node scripts/link-local-extras.mjs D:\path\to\dsh-extras-checkout
 *
 * Undo with `pnpm install` (restores the registry layout).
 */
import { symlink, rm, lstat, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, isAbsolute, join, resolve } from 'node:path'

const adapterRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const extrasRoot = process.argv[2]
const linkPath = join(adapterRoot, 'node_modules', '@catheadowl', 'dsh-extras')

if (extrasRoot === undefined || !isAbsolute(extrasRoot)) {
  console.error('usage: node scripts/link-local-extras.mjs <absolute path to a local @catheadowl/dsh-extras checkout>')
  process.exit(1)
}

async function exists(path) {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

// The package is a multi-module build: each module ships its own lib. Probe
// one to catch wrong-path / unbuilt checkouts before swapping the link.
const promptLib = join(extrasRoot, 'modules', 'prompt', 'lib', 'core.js')
if (!(await exists(promptLib))) {
  console.error(`[link-local-extras] no built prompt module at ${promptLib} — wrong checkout, or run its build first; leaving the registry layout in place`)
  process.exit(1)
}

// lstat (not stat): the registry layout entry is itself a junction into
// .pnpm — stat would follow it and report a plain directory.
const current = await lstat(linkPath)
if (current.isSymbolicLink()) await rm(linkPath)
await symlink(extrasRoot, linkPath, 'junction')
console.log(`[link-local-extras] ${linkPath} -> ${extrasRoot} (registry layout shadowed; "pnpm install" restores it)`)
