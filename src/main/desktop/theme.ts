import { nativeTheme } from 'electron'
import type { ResolvedTheme, Theme } from '../../shared/types'
import type { IpcPush } from '../ipc/events'
import type { SettingsStore } from '../lib/settings'

export function resolveTheme(preference: Theme, osDark: boolean): ResolvedTheme {
  if (preference === 'system') return osDark ? 'dark' : 'light'
  return preference
}

/**
 * Theme wiring: `nativeTheme.themeSource` follows the setting; the resolved
 * theme is pushed as `theme:changed` whenever the OS or the setting changes.
 */
export function installTheme(settings: SettingsStore, push: IpcPush): { current(): ResolvedTheme } {
  const apply = (): ResolvedTheme => {
    const preference = settings.get().theme
    nativeTheme.themeSource = preference
    return resolveTheme(preference, nativeTheme.shouldUseDarkColors)
  }
  let current = apply()
  const announce = (): void => {
    const next = apply()
    if (next === current) return
    current = next
    push.send('theme:changed', { theme: current })
  }
  nativeTheme.on('updated', announce)
  settings.onChange(announce)
  return { current: () => current }
}
