import { BrowserWindow, screen } from 'electron'
import { computeEdgeAnchoredPosition } from '../positioning'
import { hardenWebContents } from '../security'
import { appWebPreferences, loadRenderer } from './library-window'

/** Shelf panel size (DIP). */
export const SHELF_SIZE = { width: 300, height: 190 } as const

const SHELF_TOP_GAP = 12

/**
 * The Shelf: a small always-on-top drop target. Frameless, transparent,
 * `type: 'panel'`, floating level, visible on every Space including full-screen apps, non-activating.
 * Shown by the drag watcher while a drag is in flight, or by the tray, ⌘⇧K and the menu.
 * Renderer route `?view=shelf`.
 */
export function createShelfWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: SHELF_SIZE.width,
    height: SHELF_SIZE.height,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: true,
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

/** Dock the shelf to the top-right of the display under the cursor. */
export function positionShelf(window: BrowserWindow): void {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const pos = computeEdgeAnchoredPosition({ windowSize: SHELF_SIZE, workArea: display.workArea, topGap: SHELF_TOP_GAP })
  window.setBounds({ x: pos.x - 16, y: pos.y, width: SHELF_SIZE.width, height: SHELF_SIZE.height })
}
