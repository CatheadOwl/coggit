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
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const host = process.env.DSH_REPO
if (!host) {
  console.error(
    '[build-client] DSH_REPO is not set. It is the machine-level anchor pointing at a built deepseek-harness checkout.\n' +
      'Remedy: set it (e.g. $env:DSH_REPO = "D:/.../deepseek-harness"), ensure the checkout is built (pnpm install && pnpm build), then re-run.',
  )
  process.exit(1)
}

// Resolve the tsdown JS entry and run it with the current node executable:
// spawning a `.cmd` shim via child_process without `shell: true` is rejected
// as EINVAL on Node >= 20.12.2 (CVE-2024-27980 hardening) on Windows.
const binDir = join(host, 'node_modules', '.bin')
const ext = process.platform === 'win32' ? '.cmd' : ''
const bin = join(binDir, 'tsdown' + ext)
if (!existsSync(bin)) {
  console.error(`[build-client] tsdown bin missing at ${bin} — is the host checkout installed?`)
  process.exit(1)
}
const pkgPath = join(host, 'node_modules', 'tsdown', 'package.json')
if (!existsSync(pkgPath)) {
  console.error(`[build-client] tsdown package missing at ${pkgPath} — is the host checkout installed?`)
  process.exit(1)
}
const { bin: binField } = JSON.parse(readFileSync(pkgPath, 'utf8'))
const jsEntry = join(host, 'node_modules', 'tsdown', typeof binField === 'string' ? binField : binField.tsdown)
if (!existsSync(jsEntry)) {
  console.error(`[build-client] tsdown JS entry missing at ${jsEntry}`)
  process.exit(1)
}

const result = spawnSync(process.execPath, [jsEntry], {
  stdio: 'inherit',
  cwd: resolve('.'),
  env: { ...process.env, DSH_REPO: host },
})
if (result.status !== 0) process.exit(result.status ?? 1)

// Publish hygiene: the bundler's `#region` markers embed machine-absolute
// source paths into lib/client.js. Rewritten artifacts must not carry the
// release machine's checkout location, so strip the cwd prefix from the
// emitted bundle (comment-only regions — no runtime semantics).
const outFile = resolve('lib', 'client.js')
let text = readFileSync(outFile, 'utf8')
const cwd = process.cwd()
const sanitized = text
  .replaceAll(cwd.replaceAll('\\', '/') + '/', '')
  .replaceAll(cwd.replaceAll('\\', '/'), '')
  .replaceAll(cwd + '\\', '')
  .replaceAll(cwd, '')
if (sanitized !== text) {
  writeFileSync(outFile, sanitized)
  console.log('[build-client] sanitized absolute build paths in lib/client.js')
}

process.exit(0)
