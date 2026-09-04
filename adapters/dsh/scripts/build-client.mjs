#!/usr/bin/env node
/**
 * Build the web client bundle with the host checkout's tsdown.
 *
 * tsdown and the `clientBundle` preset are host-source tooling, not npm
 * artifacts. The host checkout location is known only to the machine-level
 * `DSH_REPO` anchor; no repo-committed path carries it. Fails loud with the
 * remedy when the anchor is missing (never guesses a path).
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const host = process.env.DSH_REPO
if (!host) {
  console.error(
    '[build-client] DSH_REPO is not set. It is the machine-level anchor pointing at a built deepseek-harness checkout.\n' +
      'Remedy: set it (e.g. $env:DSH_REPO = "D:/.../deepseek-harness"), ensure the checkout is built (pnpm install && pnpm build), then re-run.',
  )
  process.exit(1)
}

const bin = join(host, 'node_modules', '.bin', process.platform === 'win32' ? 'tsdown.cmd' : 'tsdown')
if (!existsSync(bin)) {
  console.error(`[build-client] tsdown bin missing at ${bin} — is the host checkout installed?`)
  process.exit(1)
}

const result = spawnSync(bin, [], {
  stdio: 'inherit',
  cwd: resolve('.'),
  env: { ...process.env, DSH_REPO: host },
})
process.exit(result.status ?? 1)
