import { describe, expect, it } from 'vitest'
import {
  clamp,
  clampToBounds,
  computeEdgeAnchoredPosition,
  computeEdgeDockedPosition,
  computePanelPosition,
  type Rect
} from '../../src/main/positioning'
import { LAYOUT, railAnchorX } from '../../src/shared/layout'

// A 1512x982 MacBook display (logical) with a 38px menu bar => work area starts at y=38.
const workArea: Rect = { x: 0, y: 38, width: 1512, height: 944 }
const windowSize = LAYOUT.window
const anchorOffsetX = railAnchorX()

describe('clamp helpers', () => {
  it('clamp respects bounds and inverted ranges', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(11, 0, 10)).toBe(10)
    expect(clamp(5, 10, 0)).toBe(10)
  })
  it('clampToBounds keeps a rect inside', () => {
    expect(clampToBounds({ x: -10, y: -10, width: 100, height: 100 }, workArea)).toEqual({ x: 0, y: 38 })
    expect(clampToBounds({ x: 2000, y: 2000, width: 100, height: 100 }, workArea)).toEqual({ x: 1412, y: 882 })
  })
})

describe('computeEdgeAnchoredPosition', () => {
  it('docks the window to the top-right of the work area', () => {
    const pos = computeEdgeAnchoredPosition({ windowSize, workArea, topGap: 4 })
    expect(pos.x + windowSize.width).toBe(workArea.x + workArea.width)
    expect(pos.y).toBe(workArea.y + 4)
    expect(pos.placement).toBe('below')
  })

  it('works on a secondary display with a non-zero origin', () => {
    const external: Rect = { x: 1512, y: -400, width: 2560, height: 1415 }
    const pos = computeEdgeAnchoredPosition({ windowSize, workArea: external, topGap: 4 })
    expect(pos.x + windowSize.width).toBe(external.x + external.width)
    expect(pos.y).toBe(external.y + 4)
  })

  it('stays inside a work area shorter than the window', () => {
    const shortArea: Rect = { x: 0, y: 38, width: 1512, height: 300 }
    const pos = computeEdgeAnchoredPosition({ windowSize, workArea: shortArea, topGap: 4 })
    expect(pos.y).toBe(shortArea.y)
  })
})

describe('computeEdgeDockedPosition', () => {
  const size = { width: 292, height: 340 }

  it('sits flush against the right edge, centred vertically', () => {
    const pos = computeEdgeDockedPosition({ windowSize: size, workArea, edge: 'right' })
    expect(pos.x + size.width).toBe(workArea.x + workArea.width)
    expect(pos.y).toBe(38 + Math.round((944 - 340) / 2))
  })

  it('sits flush against the left edge', () => {
    const pos = computeEdgeDockedPosition({ windowSize: size, workArea, edge: 'left' })
    expect(pos.x).toBe(workArea.x)
  })

  it('respects a secondary display origin and a Dock that trims the work area', () => {
    const external: Rect = { x: 1512, y: -400, width: 2560, height: 1415 }
    const pos = computeEdgeDockedPosition({ windowSize: size, workArea: external, edge: 'right' })
    expect(pos.x + size.width).toBe(external.x + external.width)
    expect(pos.y).toBe(-400 + Math.round((1415 - 340) / 2))
  })

  it('stays inside a work area shorter than the window', () => {
    const shortArea: Rect = { x: 0, y: 38, width: 1512, height: 300 }
    const pos = computeEdgeDockedPosition({ windowSize: size, workArea: shortArea, edge: 'right' })
    expect(pos.y).toBe(shortArea.y)
  })
})

describe('computePanelPosition', () => {
  it('centres the rail under the tray icon and opens below the menu bar', () => {
    const trayBounds: Rect = { x: 1200, y: 0, width: 28, height: 38 }
    const pos = computePanelPosition({ trayBounds, windowSize, workArea, anchorOffsetX, gap: 6 })
    expect(pos.placement).toBe('below')
    expect(pos.y).toBe(38 + 6)
    expect(pos.x + anchorOffsetX).toBe(1214) // tray centre
  })

  it('clamps to the right edge when the icon is near the display corner', () => {
    const trayBounds: Rect = { x: 1490, y: 0, width: 22, height: 38 }
    const pos = computePanelPosition({ trayBounds, windowSize, workArea, anchorOffsetX, gap: 6 })
    expect(pos.x + windowSize.width).toBe(workArea.x + workArea.width)
  })

  it('clamps to the left edge', () => {
    const trayBounds: Rect = { x: 10, y: 0, width: 22, height: 38 }
    const pos = computePanelPosition({ trayBounds, windowSize, workArea, anchorOffsetX })
    expect(pos.x).toBe(workArea.x)
  })

  it('clamps to the bottom when the work area is very short', () => {
    const shortArea: Rect = { x: 0, y: 38, width: 1512, height: 420 }
    const trayBounds: Rect = { x: 700, y: 0, width: 22, height: 38 }
    // A large gap would push the window past the bottom; it must be pulled back inside.
    const pos = computePanelPosition({ trayBounds, windowSize, workArea: shortArea, anchorOffsetX, gap: 100 })
    expect(pos.y + windowSize.height).toBeLessThanOrEqual(shortArea.y + shortArea.height)
    expect(pos.y).toBe(shortArea.y + shortArea.height - windowSize.height)
  })

  it('handles a secondary display with a non-zero origin', () => {
    const external: Rect = { x: 1512, y: -400, width: 2560, height: 1415 }
    const trayBounds: Rect = { x: 3800, y: -425, width: 24, height: 25 }
    const pos = computePanelPosition({ trayBounds, windowSize, workArea: external, anchorOffsetX, gap: 6 })
    expect(pos.y).toBe(-400 + 6)
    expect(pos.x).toBeGreaterThanOrEqual(external.x)
    expect(pos.x + windowSize.width).toBeLessThanOrEqual(external.x + external.width)
    expect(pos.x + anchorOffsetX).toBe(3812)
  })

  it('opens above a bottom-anchored tray icon', () => {
    const bottomArea: Rect = { x: 0, y: 0, width: 1920, height: 1040 }
    const trayBounds: Rect = { x: 1700, y: 1040, width: 24, height: 40 }
    const pos = computePanelPosition({ trayBounds, windowSize, workArea: bottomArea, anchorOffsetX, gap: 4 })
    expect(pos.placement).toBe('above')
    expect(pos.y + windowSize.height).toBe(1040 - 4)
  })

  it('falls back to the top-right corner when tray bounds are empty', () => {
    const pos = computePanelPosition({ trayBounds: { x: 0, y: 0, width: 0, height: 0 }, windowSize, workArea, gap: 6 })
    expect(pos.x + windowSize.width).toBe(workArea.x + workArea.width)
    expect(pos.y).toBe(workArea.y + 6)
  })

  it('never exceeds the work area on any side for random inputs', () => {
    for (let i = 0; i < 200; i++) {
      const trayBounds: Rect = { x: ((i * 97) % 1600) - 50, y: 0, width: 22, height: 38 }
      const pos = computePanelPosition({ trayBounds, windowSize, workArea, anchorOffsetX })
      expect(pos.x).toBeGreaterThanOrEqual(workArea.x)
      expect(pos.y).toBeGreaterThanOrEqual(workArea.y)
      expect(pos.x + windowSize.width).toBeLessThanOrEqual(workArea.x + workArea.width)
      expect(pos.y + windowSize.height).toBeLessThanOrEqual(workArea.y + workArea.height)
    }
  })
})
