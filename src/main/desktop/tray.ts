import { readFileSync } from 'node:fs'
import { Menu, nativeImage, type Rectangle, screen, Tray } from 'electron'
import trayIcon2x from '../../../assets/tray/trayTemplate@2x.png?asset'
import trayIcon1x from '../../../assets/tray/trayTemplate.png?asset'
import type { Logger } from '../ports'
import { isPlausibleTrayBounds } from '../positioning'

export interface TrayActions {
  toggleShelf(): void
  showLibrary(): void
  /** A drag entered the status item: open the shelf so there is a real target below it. */
  armShelf(): void
  disarmShelf(): void
  /** Files or text dropped straight onto the status item. */
  keepDropped(payload: { files?: string[]; text?: string }): void
  quit(): void
}

export interface TrayController {
  /** Last plausible bounds of the status item (from click events; `getBounds()` lies at launch). */
  bounds(): Rectangle | null
  destroy(): void
}

function trayImage(): Electron.NativeImage {
  const image = nativeImage.createEmpty()
  image.addRepresentation({ scaleFactor: 1, buffer: readFileSync(trayIcon1x) })
  image.addRepresentation({ scaleFactor: 2, buffer: readFileSync(trayIcon2x) })
  image.setTemplateImage(true)
  return image
}

/** Create the menu-bar status item. Left click toggles the shelf; right click shows the menu. */
export function createTray(actions: TrayActions, logger: Logger): TrayController {
  const tray = new Tray(trayImage())
  tray.setToolTip('KeepAnything')
  let lastBounds: Rectangle | null = null

  const remember = (bounds: Rectangle | undefined): void => {
    if (!bounds) return
    const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y })
    if (isPlausibleTrayBounds(bounds, display.bounds)) lastBounds = bounds
    else logger.debug('ignoring implausible tray bounds', { bounds })
  }

  const menu = Menu.buildFromTemplate([
    { label: 'Open Library', click: () => actions.showLibrary() },
    { label: 'Toggle Shelf', sublabel: '⌘⇧K', click: () => actions.toggleShelf() },
    { type: 'separator' },
    { label: 'Quit KeepAnything', click: () => actions.quit() }
  ])

  tray.on('click', (_event, bounds) => {
    remember(bounds)
    actions.toggleShelf()
  })
  tray.on('right-click', (_event, bounds) => {
    remember(bounds)
    tray.popUpContextMenu(menu)
  })

  // Dragging to the menu bar works even when the drag watcher is missing, and it is the one gesture
  // that is discoverable from the icon alone. `drag-leave` is deliberately ignored: the user is
  // usually on their way down to the shelf, and `drag-end` closes it if they are not.
  tray.on('drag-enter', () => actions.armShelf())
  tray.on('drag-end', () => actions.disarmShelf())
  tray.on('drop-files', (_event, files) => actions.keepDropped({ files }))
  tray.on('drop-text', (_event, text) => actions.keepDropped({ text }))

  return {
    bounds: () => lastBounds,
    destroy: () => tray.destroy()
  }
}
