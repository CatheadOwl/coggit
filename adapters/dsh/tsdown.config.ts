/**
 * Client-bundle config. The `clientBundle` preset is host-source tooling and is
 * NOT shipped on npm; it resolves through the machine-local `DSH_REPO` anchor
 * (the single channel that knows the host checkout location — never a
 * repo-committed relative path). Same resolution model as dsh-eval's host CLI
 * chain (flag > resolution layer > legacy config; repo keys retired).
 */
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

async function loadClientBundle() {
  const host = process.env.DSH_REPO
  if (!host) {
    throw new Error(
      'DSH_REPO is not set. It is the machine-level anchor pointing at a built deepseek-harness checkout. ' +
        'Set it (e.g. $env:DSH_REPO = "D:/.../deepseek-harness") and re-run pnpm build:client.',
    )
  }
  const preset = join(host, 'packages', 'client', 'tsdown.client.ts')
  const mod = (await import(pathToFileURL(preset).href)) as {
    clientBundle: (
      name: string,
      entries: string[],
      options: { hostPhase: boolean },
    ) => unknown
  }
  return mod.clientBundle
}

const clientBundle = await loadClientBundle()

export default clientBundle('@catheadowl/dsh-coggit', ['lib/types/index.js'], {
  hostPhase: true,
})
