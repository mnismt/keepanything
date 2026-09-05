/**
 * Single source of truth for the floating window geometry (logical pixels).
 * The main process uses it to size/anchor the BrowserWindow; the renderer uses
 * it to lay out the rail and detail card so that the rail centre sits directly
 * under the menu-bar icon.
 */
export const LAYOUT = {
  /** Total transparent BrowserWindow size. */
  window: { width: 470, height: 404 },
  /** Transparent margin around the panels so CSS shadows are never clipped. */
  margin: { top: 8, right: 14, bottom: 28, left: 14 },
  /** Vertical rail with the three rings. */
  rail: { width: 108, notchHeight: 12 },
  /** Distance between the rail's left edge and the detail card's right edge (tail lives here). */
  cardGap: 14,
  /** Detail card (speech bubble). */
  card: { width: 320 },
  /** Vertical gap between the bottom of the menu bar / tray icon and the window top. */
  trayGap: 4,
  /**
   * How the window is anchored on screen.
   * - `right-edge`: docked to the right edge of the display's work area, just below the menu bar
   *   (the rail sits `margin.right` px from the screen edge; the notch is not drawn).
   * - `tray`: centred under the menu-bar icon with a notch pointing at it.
   */
  anchorMode: 'right-edge' as AnchorMode
} as const

export type AnchorMode = 'right-edge' | 'tray'

/** X offset (from the window's left edge) of the rail's horizontal centre. */
export function railAnchorX(): number {
  return LAYOUT.window.width - LAYOUT.margin.right - LAYOUT.rail.width / 2
}

/** Which screen edge the shelf grows out of. */
export type ShelfEdge = 'left' | 'right'

/**
 * Shelf geometry (logical pixels). The panel sits flush against a screen edge like a notch in the
 * bezel: the body's outer side is the edge itself, its inner corners are rounded, and above and
 * below it a concave `fillet` blends the panel back into the edge. The transparent `shadow` margin
 * on the inner side keeps the drop shadow from being clipped by the window.
 */
export const SHELF = {
  body: { width: 224, height: 288 },
  radius: 18,
  fillet: 20,
  shadow: 28
} as const

/** Total transparent BrowserWindow size for the shelf. */
export const SHELF_WINDOW = {
  width: SHELF.body.width + SHELF.shadow,
  height: SHELF.body.height + SHELF.fillet * 2
} as const

/** How long the shelf's exit slide takes; main hides the window only after it has played. */
export const SHELF_EXIT_MS = 260
