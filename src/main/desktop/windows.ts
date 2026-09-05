import { join } from 'node:path'
import { app, BrowserWindow, screen, type WebContents } from 'electron'
import type { Logger } from '../ports'
import { containsPoint } from '../positioning'
import { nextShelfState, type ShelfDecision, type ShelfPresence } from '../shelf-policy'
import { createLibraryWindow } from './library-window'
import { createShelfWindow, positionShelf } from './shelf-window'

/** Owns the library window and the shelf; the single source of "known senders" for the IPC router. */
export interface WindowManager {
  showLibrary(): BrowserWindow
  libraryWindow(): BrowserWindow | null
  toggleShelf(): void
  showShelf(): void
  hideShelf(): void
  /**
   * Build the shelf window up front, hidden. A window created in the middle of a drag is not a
   * drop target yet (no renderer, no registered dragged types), so it has to exist before the
   * first drag. Call once, after the IPC router is registered.
   */
  prewarmShelf(): void
  /**
   * A drag began somewhere on the desktop: show the shelf so there is something to drop on.
   * Ignored when the drag is one of ours (started over, or from, a KeepAnything window).
   */
  armShelf(): void
  /** That drag ended: hide the shelf again, unless it was dropped on or the user pinned it. */
  disarmShelf(): void
  /** Something was just kept through the shelf or the status item: keep the receipt on screen. */
  noteShelfDrop(): void
  /** Live web contents of every app window (push targets). */
  webContents(): WebContents[]
  isKnownSender(id: number): boolean
  destroyAll(): void
}

export interface WindowManagerDeps {
  isQuitting: () => boolean
  logger: Logger
}

export function createWindowManager(deps: WindowManagerDeps): WindowManager {
  let library: BrowserWindow | null = null
  let shelf: BrowserWindow | null = null
  let presence: ShelfPresence = 'hidden'
  let autoHide: ReturnType<typeof setTimeout> | null = null
  /** Did the drag currently being tracked end in something being kept? */
  let kept = false

  const setPolicy = (policy: 'regular' | 'accessory'): void => {
    if (process.platform !== 'darwin') return
    try {
      app.setActivationPolicy(policy)
      // Unpackaged runs use the stock Electron.app, whose Dock tile is Electron's. macOS rebuilds
      // the tile on every accessory -> regular switch, so the icon is reapplied here rather than once
      // at startup. The name still reads "Electron" (Info.plist); only a packaged build fixes that.
      if (policy === 'regular' && !app.isPackaged) {
        app.dock?.setIcon(join(app.getAppPath(), 'build/icon.png'))
      }
    } catch (error) {
      deps.logger.debug('setActivationPolicy failed', { policy, error })
    }
  }

  const showLibrary = (): BrowserWindow => {
    if (library && !library.isDestroyed()) {
      setPolicy('regular')
      if (library.isMinimized()) library.restore()
      library.show()
      library.focus()
      return library
    }
    setPolicy('regular')
    library = createLibraryWindow()
    library.on('close', (event) => {
      if (deps.isQuitting()) return
      // Closing hides: tray and shelf keep running as an accessory app.
      event.preventDefault()
      library?.hide()
      setPolicy('accessory')
    })
    library.on('closed', () => {
      library = null
    })
    return library
  }

  const ensureShelf = (): BrowserWindow => {
    if (shelf && !shelf.isDestroyed()) return shelf
    shelf = createShelfWindow()
    shelf.on('closed', () => {
      shelf = null
    })
    return shelf
  }

  const live = (): BrowserWindow[] => [library, shelf].filter((w): w is BrowserWindow => w !== null && !w.isDestroyed())

  const cancelAutoHide = (): void => {
    if (autoHide) clearTimeout(autoHide)
    autoHide = null
  }

  /** Run one decision from `shelf-policy`: move the window, then (re)arm the auto-hide timer. */
  const apply = (decision: ShelfDecision): void => {
    presence = decision.presence
    cancelAutoHide()
    if (decision.action === 'show') {
      const window = ensureShelf()
      positionShelf(window)
      // Never `show()`: taking focus in the middle of a drag can cancel the drag in the source app.
      window.showInactive()
    } else if (decision.action === 'hide') {
      if (shelf && !shelf.isDestroyed() && shelf.isVisible()) shelf.hide()
    }
    if (decision.hideAfterMs !== null) {
      autoHide = setTimeout(() => {
        autoHide = null
        apply(nextShelfState(presence, { kind: 'linger-elapsed' }))
      }, decision.hideAfterMs)
    }
  }

  const pointerOver = (window: BrowserWindow | null): boolean =>
    Boolean(
      window &&
        !window.isDestroyed() &&
        window.isVisible() &&
        containsPoint(window.getBounds(), screen.getCursorScreenPoint())
    )

  /**
   * Dragging an item out of the library or off the shelf is a move inside the app, not a capture,
   * so it must not pop the shelf. A drag out of the library activates us, which `isFocused` catches;
   * the shelf is non-activating, so that one needs the pointer. Deliberately not a hit test against
   * every window: `getBounds()` knows nothing about z-order, and an open library window sitting
   * behind someone else's Finder window would swallow every real drag.
   */
  const ownDrag = (): boolean => live().some((w) => w.isFocused()) || pointerOver(shelf)

  return {
    showLibrary,
    libraryWindow: () => (library && !library.isDestroyed() ? library : null),
    prewarmShelf: () => void ensureShelf(),
    toggleShelf: () => apply(nextShelfState(presence, { kind: 'manual-toggle' })),
    showShelf: () => apply(nextShelfState(presence, { kind: 'manual-show' })),
    hideShelf: () => apply(nextShelfState(presence, { kind: 'manual-hide' })),
    armShelf() {
      if (ownDrag()) return
      kept = false
      apply(nextShelfState(presence, { kind: 'drag-start' }))
    },
    disarmShelf() {
      // A drop on the shelf is normally reported by `noteShelfDrop`, but the pointer position
      // catches the case where the capture round trip has not come back yet.
      const landed = kept || pointerOver(shelf)
      kept = false
      apply(nextShelfState(presence, { kind: 'drag-end', kept: landed }))
    },
    noteShelfDrop() {
      kept = true
      // The drop already ended the drag, so the auto-hide from `disarmShelf` may be running: this
      // replaces its 350ms with the linger, whichever of the two arrived first.
      apply(nextShelfState(presence, { kind: 'drag-end', kept: true }))
    },
    webContents: () => live().map((w) => w.webContents),
    isKnownSender: (id) => live().some((w) => w.webContents.id === id),
    destroyAll() {
      cancelAutoHide()
      for (const w of live()) w.destroy()
      library = null
      shelf = null
    }
  }
}
