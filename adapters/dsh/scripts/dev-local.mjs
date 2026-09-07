/**
 * One-command dev-local switch against a local `@catheadowl/dsh-extras`
 * checkout: rebuild that checkout, rebuild this adapter's lib/, re-point the
 * adapter's extras entry at the checkout, and rebuild the @deepseek-ai peer
 * junctions (a build or install drops them).
 *
 * The checkout path is required — where local checkouts live is machine-local
 * knowledge this script deliberately does not embed.
 *
 *   node scripts/dev-local.mjs D:\path\to\dsh-extras-checkout
 *
 * Dev ↔ release switching:
 *   dev:local    → this script (needs the checkout path)
 *   dev:registry → pnpm install (restores registry extras) + relink
 */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, isAbsolute, resolve } from 'node:path'

const adapterRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const extrasRoot = process.argv[2]

if (extrasRoot === undefined || !isAbsolute(extrasRoot)) {
  console.error('usage: node scripts/dev-local.mjs <absolute path to a local @catheadowl/dsh-extras checkout>')
  process.exit(1)
}

function run(command, args, cwd) {
  console.log(`[dev:local] ${command} ${args.join(' ')}${cwd ? ` (in ${cwd})` : ''}`)
  // Windows: pnpm resolves to pnpm.cmd, which execFileSync cannot spawn
  // without a shell.
  execFileSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
}

run('pnpm', ['--dir', extrasRoot, 'run', 'build'])
run('pnpm', ['run', 'build'], adapterRoot)
run('node', [resolve(adapterRoot, 'scripts', 'link-local-extras.mjs'), extrasRoot], adapterRoot)
run('node', [resolve(adapterRoot, 'scripts', 'relink-dsh-peers.mjs')], adapterRoot)
console.log('[dev:local] done — adapter lib/ and the local checkout build are current')
