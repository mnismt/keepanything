import { describe, expect, it } from 'vitest'
import {
  bodyHeight,
  columnCount,
  layoutMasonry,
  type MasonryInput,
  nearestInDirection
} from '../../src/renderer/src/lib/masonry'

const opts = { containerWidth: 1000, minColumnWidth: 220, gap: 14, captionHeight: 44 }

function items(n: number, type: MasonryInput['type'] = 'image'): MasonryInput[] {
  return Array.from({ length: n }, (_, i) => ({ id: `i${i}`, type, width: 400, height: 300 + (i % 3) * 200 }))
}

describe('masonry layout', () => {
  it('derives the column count from the min width and gap, never below 1', () => {
    expect(columnCount(1000, 220, 14)).toBe(4)
    expect(columnCount(234, 220, 14)).toBe(1)
    expect(columnCount(100, 220, 14)).toBe(1)
    expect(columnCount(0, 220, 14)).toBe(1)
  })

  it('reserves body height from intrinsic size, falling back to per-type ratios', () => {
    expect(bodyHeight({ type: 'image', width: 400, height: 300 }, 200)).toBe(150)
    expect(bodyHeight({ type: 'url', width: null, height: null }, 160)).toBe(100)
    expect(bodyHeight({ type: 'pdf', width: null, height: null }, 100)).toBe(130)
  })

  it('clamps extreme ratios', () => {
    expect(bodyHeight({ type: 'image', width: 100, height: 5000 }, 100)).toBe(160)
    expect(bodyHeight({ type: 'image', width: 5000, height: 100 }, 100)).toBe(50)
  })

  it('places cards into the shortest column in reading order and never overlaps', () => {
    const layout = layoutMasonry(items(12), opts)
    expect(layout.columns).toBe(4)
    expect(layout.order).toHaveLength(12)
    // First row fills columns left to right.
    expect(['i0', 'i1', 'i2', 'i3'].map((id) => layout.rects[id]?.column)).toEqual([0, 1, 2, 3])
    // No two rects in the same column overlap.
    const byCol = new Map<number, { y: number; h: number }[]>()
    for (const r of Object.values(layout.rects)) {
      const list = byCol.get(r.column) ?? []
      list.push({ y: r.y, h: r.h })
      byCol.set(r.column, list)
    }
    for (const list of byCol.values()) {
      list.sort((a, b) => a.y - b.y)
      for (let i = 1; i < list.length; i++) {
        const prev = list[i - 1]
        const cur = list[i]
        expect(cur && prev ? cur.y >= prev.y + prev.h + opts.gap : false).toBe(true)
      }
    }
    // Total height equals the tallest column minus the trailing gap.
    const tallest = Math.max(...[...byCol.values()].map((l) => l.reduce((m, r) => Math.max(m, r.y + r.h), 0)))
    expect(layout.height).toBe(tallest)
  })

  it('fifth card goes under the shortest of the first four', () => {
    const layout = layoutMasonry(items(5), opts)
    // Heights cycle 300/500/700/300 → columns 0 and 3 are shortest; ties resolve to the leftmost.
    expect(layout.rects.i4?.column).toBe(0)
    expect(layout.rects.i4?.y).toBe((layout.rects.i0?.h ?? 0) + opts.gap)
  })

  it('is deterministic and empty-safe', () => {
    expect(layoutMasonry([], opts)).toEqual({ columns: 4, columnWidth: 239, height: 0, rects: {}, order: [] })
    expect(layoutMasonry(items(7), opts)).toEqual(layoutMasonry(items(7), opts))
  })

  it('uses the full width for a single column', () => {
    const layout = layoutMasonry(items(3), { ...opts, containerWidth: 300 })
    expect(layout.columns).toBe(1)
    expect(layout.columnWidth).toBe(300)
    expect(layout.rects.i1?.y).toBe((layout.rects.i0?.h ?? 0) + opts.gap)
  })
})

describe('nearestInDirection', () => {
  const layout = layoutMasonry(items(8), opts)

  it('moves right/left along the first row', () => {
    expect(nearestInDirection(layout, 'i0', 'right')).toBe('i1')
    expect(nearestInDirection(layout, 'i1', 'left')).toBe('i0')
    expect(nearestInDirection(layout, 'i0', 'left')).toBeNull()
  })

  it('prefers the same column when moving down and up', () => {
    const below = nearestInDirection(layout, 'i0', 'down')
    expect(below).not.toBeNull()
    expect(layout.rects[below as string]?.column).toBe(0)
    expect(nearestInDirection(layout, below as string, 'up')).toBe('i0')
  })

  it('returns null for unknown ids and when nothing lies in that direction', () => {
    expect(nearestInDirection(layout, 'nope', 'down')).toBeNull()
    const single = layoutMasonry(items(1), opts)
    expect(nearestInDirection(single, 'i0', 'down')).toBeNull()
  })
})
