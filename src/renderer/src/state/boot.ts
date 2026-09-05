/**
 * Subscribe to every push event exactly once and load the initial data. Called from
 * `main.tsx` before the first render; safe to call twice (second call is a no-op).
 */
import { IPC_EVENTS } from '../../../shared/ipc'
import { isMockBridge, on } from '../lib/ipc-client'
import { useCollections } from './collections'
import { useJobs } from './jobs'
import { useLibrary } from './library'
import { useRuns } from './runs'
import { useSettings } from './settings'
import { useToasts } from './toasts'
import { useUi } from './ui'

let booted = false
const unsubscribers: Array<() => void> = []

export function bootRenderer(): void {
  if (booted) return
  booted = true

  unsubscribers.push(
    on(IPC_EVENTS.itemsChanged, (event) => {
      useLibrary.getState().applyItemsChanged(event)
      void useSettings.getState().loadStats()
    }),
    on(IPC_EVENTS.jobsProgress, (progress) => useJobs.getState().applyProgress(progress)),
    on(IPC_EVENTS.collectionsChanged, () => {
      void useCollections.getState().load()
      if (useLibrary.getState().query.view === 'collection') void useLibrary.getState().load()
    }),
    on(IPC_EVENTS.agentRun, (event) => useRuns.getState().applyEvent(event)),
    on(IPC_EVENTS.shelfDropped, ({ result }) => {
      const n = result.items.length
      if (n === 0) return
      useToasts.getState().push({ text: n === 1 ? 'Saved.' : `Saved ${n} things.` })
    }),
    on(IPC_EVENTS.settingsChanged, ({ settings }) => useSettings.getState().applyChanged(settings)),
    on(IPC_EVENTS.themeChanged, ({ theme }) => useUi.getState().setTheme(theme))
  )

  // Initial theme from the OS until main says otherwise.
  if (typeof matchMedia === 'function') {
    const light = matchMedia('(prefers-color-scheme: light)')
    useUi.getState().setTheme(light.matches ? 'light' : 'dark')
    // Without main (mock bridge) follow the OS live; with main, `theme:changed` is authoritative.
    if (isMockBridge()) light.addEventListener('change', (e) => useUi.getState().setTheme(e.matches ? 'light' : 'dark'))
  }

  const route = useUi.getState().route
  void useSettings.getState().load()
  void useSettings.getState().loadStats()
  if (route === 'library') {
    void useLibrary.getState().load()
    void useCollections.getState().load()
    void useJobs.getState().load()
  }
}

/** Test/HMR helper. */
export function shutdownRenderer(): void {
  for (const off of unsubscribers.splice(0)) off()
  booted = false
}
