import { KaError } from '../../core/errors'
import type { HandlerMap } from '../router'
import type { HandlerDeps } from './deps'

type SettingsHandlers = Pick<
  HandlerMap,
  'settings:get' | 'settings:update' | 'settings:testConnection' | 'settings:resetData'
>

/** Settings handlers. The API key never leaves main in plain text. */
export function createSettingsHandlers(deps: HandlerDeps): SettingsHandlers {
  return {
    'settings:get': () => deps.settings.get(),
    'settings:resetData': async (_payload, ctx) => {
      if (!deps.resetData) throw new KaError('NOT_IMPLEMENTED', 'Reset data is only available in the desktop app.')
      await deps.resetData(ctx.senderId)
    },
    'settings:update': (patch) => {
      const settings = deps.settings.update(patch)
      deps.onSettingsChanged?.()
      return settings
    },
    'settings:testConnection': async () => {
      if (!deps.testConnection)
        throw new KaError('NOT_IMPLEMENTED', "Connection tests aren't available in this build yet.")
      return deps.testConnection()
    }
  }
}
