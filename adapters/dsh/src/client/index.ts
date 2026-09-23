import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the plugins-page config slot contract (SlotMap merge)
// without re-declaring it.
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
// Type-only: pulls the `ctx.slots` Context augmentation (the registry service
// is provided by the renderer plugin; the host face never imports it at runtime).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the GlobalStandardProps merges that type the root-scope
// `useSessions`/`useWorkspaces` standard hooks this config form consumes.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'

import { CoggitInitTab } from './CoggitInitTab.js'
import type { CoggitInitTabInjected } from './CoggitInitTab.js'
import { en, type CoggitInitLocaleKey, zh } from './locales.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'plugins.coggit': CoggitInitLocaleKey
  }
}

const NS = 'plugins.coggit'

export const inject = ['slots', 'locale', 'connection']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'coggit: init dictionaries')

  // `connection` is in `inject` so the fiber waits for the wire-root connection
  // plugin, but read via strict `ctx.get` + cast: the browser face declares no
  // `Context.connection` augmentation (only the host half rpc-host.ts declares
  // `HostConnectionHandle`), so `ctx.connection` does not type-check here.
  const connection = ctx.get('connection') as ConnectionHandle
  const call = async <T,>(method: string, args: Record<string, unknown> = {}): Promise<T> => {
    const result = await connection.rpc.call('/api', `coggitInit/${method}`, { args })
    if (!result.ok) {
      throw new Error(`${result.error.code}: ${result.error.message}`)
    }
    return result.value as T
  }
  // Typert wire args key by the SOURCE-LEVEL PARAMETER NAME (`request`); an absent workspace omits the wire arg entirely (see leaf).
  const workspaceArgs = (workspace: string | undefined): Record<string, unknown> =>
    workspace === undefined ? {} : { request: { workspace } }
  const injected = (): CoggitInitTabInjected => ({
    status: workspace => call('status', workspaceArgs(workspace)),
    sourceCandidates: workspace => call('sourceCandidates', workspaceArgs(workspace)),
    init: request => call('init', { request }),
  })

  ctx.effect(() => ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
    name: 'plugins.row.config',
    key: '@coggit/dsh#coggit',
    locale: NS,
    inject: injected,
  }, CoggitInitTab)), 'coggit: row config page')
}
