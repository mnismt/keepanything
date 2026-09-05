/**
 * Settings + system stats. Reloads on `settings:changed`; theme changes flow to `ui.setTheme`.
 */
import { create } from 'zustand'
import type { TestConnectionResult } from '../../../shared/ipc'
import type { Settings, SettingsPatch, SystemStats } from '../../../shared/types'
import type { Result } from '../lib/ipc-client'
import { invoke } from '../lib/ipc-client'

export interface SettingsState {
  settings: Settings | null
  stats: SystemStats | null
  testing: boolean
  lastTest: TestConnectionResult | null
  load: () => Promise<void>
  loadStats: () => Promise<void>
  update: (patch: SettingsPatch) => Promise<Result<Settings>>
  testConnection: () => Promise<TestConnectionResult | null>
  applyChanged: (settings: Settings) => void
  reprocessAll: () => Promise<number | null>
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: null,
  stats: null,
  testing: false,
  lastTest: null,

  async load() {
    const result = await invoke('settings:get', undefined)
    if (result.ok) set({ settings: result.data })
  },

  async loadStats() {
    const result = await invoke('system:stats', undefined)
    if (result.ok) set({ stats: result.data })
  },

  async update(patch) {
    const result = await invoke('settings:update', patch)
    if (result.ok) set({ settings: result.data })
    return result
  },

  async testConnection() {
    set({ testing: true })
    const result = await invoke('settings:testConnection', undefined)
    const lastTest = result.ok
      ? result.data
      : { ok: false, model: get().settings?.model ?? '', latencyMs: 0, error: result.error.message }
    set({ testing: false, lastTest })
    void get().loadStats()
    return lastTest
  },

  applyChanged(settings) {
    set({ settings })
  },

  async reprocessAll() {
    const result = await invoke('items:reprocessAll', {})
    return result.ok ? result.data.count : null
  }
}))
