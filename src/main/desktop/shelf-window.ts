import { BrowserWindow, screen } from 'electron'
import type { IpcEventMap } from '../../shared/ipc'
import { SHELF_WINDOW, type ShelfEdge } from '../../shared/layout'
import { computeEdgeDockedPosition } from '../positioning'
import { hardenWebContents } from '../security'
import { appWebPreferences, loadRenderer } from './library-window'

/**
 * The Shelf: a small always-on-top drop target that lives flush against a screen edge. Frameless,
 * transparent, `type: 'panel'`, floating level, visible on every Space including full-screen apps,
 * non-activating. Shown by the drag watcher while a drag is in flight, or by the tray, ⌘⇧K and
 * the menu. Renderer route `?view=shelf`; the renderer draws the notch shape and the slide.
 */
export function createShelfWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: SHELF_WINDOW.width,
    height: SHELF_WINDOW.height,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    type: 'panel',
    title: 'KeepAnything Shelf',
    // The shelf spends most of its life hidden and has to paint the instant a drag shows it.
    webPreferences: { ...appWebPreferences(), backgroundThrottling: false }
  })
  window.setAlwaysOnTop(true, 'floating')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  hardenWebContents(window.webContents, { openExternalLinks: false })
  loadRenderer(window, 'shelf')
  return window
}

/** Dock the shelf flush against `edge` of the display under the cursor, centred vertically. */
export function positionShelf(window: BrowserWindow, edge: ShelfEdge): void {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const pos = computeEdgeDockedPosition({ windowSize: SHELF_WINDOW, workArea: display.workArea, edge })
  window.setBounds({ ...pos, width: SHELF_WINDOW.width, height: SHELF_WINDOW.height })
}

/** Tell the shelf renderer to slide in, or to slide out ahead of the window being hidden. */
export function announceShelf(window: BrowserWindow, payload: IpcEventMap['shelf:presence']): void {
  if (window.isDestroyed()) return
  window.webContents.send('shelf:presence', payload)
}
