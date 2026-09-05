import { globalShortcut } from 'electron'
import type { Logger } from '../ports'

/** Global shortcut for the shelf (works while other apps are focused). */
export const TOGGLE_SHELF_ACCELERATOR = 'CommandOrControl+Shift+K'

/** Register global shortcuts. Returns an unregister function for shutdown. */
export function registerShortcuts(actions: { toggleShelf(): void }, logger: Logger): () => void {
  const ok = globalShortcut.register(TOGGLE_SHELF_ACCELERATOR, () => actions.toggleShelf())
  if (!ok) logger.warn('could not register global shortcut', { accelerator: TOGGLE_SHELF_ACCELERATOR })
  return () => {
    globalShortcut.unregister(TOGGLE_SHELF_ACCELERATOR)
  }
}
