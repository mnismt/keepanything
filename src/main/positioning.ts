/**
 * Pure tray-anchoring math. No Electron imports so it can run under Vitest.
 *
 * Coordinates are logical (DIP) pixels, matching what Electron's `Tray.getBounds()`
 * and `screen.getDisplayNearestPoint()` return. Retina scale factors are already
 * factored out by Electron, so no per-display multiplication is needed here.
 */

import type { ShelfEdge } from '../shared/layout'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export interface PositionOptions {
  /** Bounds of the tray (menu-bar) icon in logical pixels. */
  trayBounds: Rect
  windowSize: Size
  /** `display.workArea` of the display that contains the tray icon. */
  workArea: Rect
  /** `display.bounds` of that display; when given, implausible tray bounds trigger the fallback. */
  displayBounds?: Rect
  /**
   * X offset inside the window that should line up with the tray icon's centre.
   * Defaults to the window's horizontal centre.
   */
  anchorOffsetX?: number
  /** Gap between the tray icon and the window edge. */
  gap?: number
}

export interface PanelPosition extends Point {
  /** Whether the panel opens below (menu bar at top) or above (dock-style bottom bar) the icon. */
  placement: 'below' | 'above'
}

export interface EdgeDockOptions {
  windowSize: Size
  /** `display.workArea` of the display to dock to. */
  workArea: Rect
  edge: ShelfEdge
}

export interface EdgePositionOptions {
  windowSize: Size
  /** `display.workArea` of the display to dock to. */
  workArea: Rect
  /** Gap between the top of the work area (bottom of the menu bar) and the window top. */
  topGap?: number
}

export function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(max, Math.max(min, value))
}

/** Clamp a rect so it lies fully inside `bounds` (falls back to the top-left when too large). */
export function clampToBounds(rect: Rect, bounds: Rect): Point {
  return {
    x: clamp(rect.x, bounds.x, bounds.x + bounds.width - rect.width),
    y: clamp(rect.y, bounds.y, bounds.y + bounds.height - rect.height)
  }
}

export function isEmptyRect(rect: Rect): boolean {
  return rect.width <= 0 || rect.height <= 0
}

/** True when `point` lies inside `rect` (top and left edges included, like window hit testing). */
export function containsPoint(rect: Rect, point: Point): boolean {
  if (isEmptyRect(rect)) return false
  return point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height
}

/**
 * macOS occasionally reports nonsense tray bounds (e.g. `{x: 0, y: <display height>}`)
 * before the status item has been laid out. Bounds are only trusted when they are
 * non-empty, finite, and start inside the display that is supposed to contain them.
 */
export function isPlausibleTrayBounds(trayBounds: Rect, displayBounds: Rect): boolean {
  const values = [trayBounds.x, trayBounds.y, trayBounds.width, trayBounds.height]
  if (values.some((v) => !Number.isFinite(v))) return false
  if (isEmptyRect(trayBounds)) return false
  const cx = trayBounds.x + trayBounds.width / 2
  const cy = trayBounds.y + trayBounds.height / 2
  return (
    cx >= displayBounds.x &&
    cx < displayBounds.x + displayBounds.width &&
    cy >= displayBounds.y &&
    cy < displayBounds.y + displayBounds.height
  )
}

/**
 * Dock the window flush against the left or right edge of the work area, centred vertically, so a
 * panel drawn up to the window's outer side reads as growing out of the screen edge.
 */
export function computeEdgeDockedPosition(options: EdgeDockOptions): Point {
  const { windowSize, workArea, edge } = options
  const x = edge === 'right' ? workArea.x + workArea.width - windowSize.width : workArea.x
  const y = Math.round(workArea.y + (workArea.height - windowSize.height) / 2)
  return clampToBounds({ x, y, ...windowSize }, workArea)
}

/**
 * Dock the window to the top-right corner of the work area, independent of where the
 * menu-bar icon is. The window's right edge is flush with the work area's right edge, so
 * the visible rail ends up `LAYOUT.margin.right` px from the screen edge.
 */
export function computeEdgeAnchoredPosition(options: EdgePositionOptions): PanelPosition {
  const { windowSize, workArea } = options
  const gap = options.topGap ?? 0
  const docked = clampToBounds(
    { x: workArea.x + workArea.width - windowSize.width, y: workArea.y + gap, ...windowSize },
    workArea
  )
  return { ...docked, placement: 'below' }
}

/**
 * Compute the top-left corner for the floating window so that `anchorOffsetX`
 * sits under the tray icon's centre, then clamp it to the display's work area.
 */
export function computePanelPosition(options: PositionOptions): PanelPosition {
  const { trayBounds, windowSize, workArea } = options
  const gap = options.gap ?? 0
  const anchorOffsetX = options.anchorOffsetX ?? windowSize.width / 2

  // Some environments report empty or bogus tray bounds. Fall back to the top-right corner.
  const trusted = options.displayBounds
    ? isPlausibleTrayBounds(trayBounds, options.displayBounds)
    : !isEmptyRect(trayBounds)
  if (!trusted) {
    const fallback = clampToBounds(
      { x: workArea.x + workArea.width - windowSize.width, y: workArea.y + gap, ...windowSize },
      workArea
    )
    return { ...fallback, placement: 'below' }
  }

  const trayCenterX = trayBounds.x + trayBounds.width / 2
  const trayCenterY = trayBounds.y + trayBounds.height / 2
  const displayCenterY = workArea.y + workArea.height / 2

  // Menu bars live at the top on macOS; a tray icon below the display centre would
  // indicate a bottom bar (not macOS today, but keeps the helper generic).
  const placement: PanelPosition['placement'] = trayCenterY <= displayCenterY ? 'below' : 'above'

  const x = Math.round(trayCenterX - anchorOffsetX)
  const y = Math.round(
    placement === 'below' ? trayBounds.y + trayBounds.height + gap : trayBounds.y - gap - windowSize.height
  )

  const clamped = clampToBounds({ x, y, ...windowSize }, workArea)
  return { ...clamped, placement }
}
