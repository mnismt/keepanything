/**
 * Masonry layout, pure. Cards are placed in the shortest column, left to right, so the grid can be
 * positioned with `transform` without measuring the DOM. Heights are reserved from the item's
 * intrinsic size or a per-type ratio so cards do not jump as media loads.
 */
import type { ItemType } from '../../../shared/types'

export interface MasonryInput {
  id: string
  type: ItemType
  width: number | null
  height: number | null
  /** Extra vertical space for the caption block (title + secondary line), in px. */
  captionHeight?: number
}

export interface MasonryOptions {
  /** Available container width in px (content box). */
  containerWidth: number
  /** Minimum column width; the count is derived from it. */
  minColumnWidth: number
  gap: number
  /** Default caption height added under every card body. */
  captionHeight: number
  /** Clamp of the body aspect ratio (height / width) so extreme images stay reasonable. */
  minRatio?: number
  maxRatio?: number
}

export interface MasonryRect {
  x: number
  y: number
  w: number
  h: number
  column: number
}

export interface MasonryLayout {
  columns: number
  columnWidth: number
  height: number
  rects: Record<string, MasonryRect>
  order: string[]
}

/** Body aspect ratio (height / width) reserved per type when no intrinsic size is known. */
export const TYPE_RATIO: Record<ItemType, number> = {
  url: 10 / 16,
  pdf: 1.3,
  file: 1,
  folder: 3 / 4,
  image: 3 / 4,
  video: 9 / 16,
  audio: 9 / 16,
  text: 0.8,
  markdown: 0.8,
  note: 0.9,
  unknown: 1
}

/** Number of columns for a container width: floor((w + gap) / (min + gap)), never below 1. */
export function columnCount(containerWidth: number, minColumnWidth: number, gap: number): number {
  if (containerWidth <= 0) return 1
  return Math.max(1, Math.floor((containerWidth + gap) / (minColumnWidth + gap)))
}

/** Reserved body height for one card at a given column width. */
export function bodyHeight(
  item: Pick<MasonryInput, 'type' | 'width' | 'height'>,
  columnWidth: number,
  minRatio = 0.5,
  maxRatio = 1.6
): number {
  let ratio = TYPE_RATIO[item.type]
  if (item.width && item.height && item.width > 0 && item.height > 0) {
    ratio = item.height / item.width
  }
  ratio = Math.min(maxRatio, Math.max(minRatio, ratio))
  return Math.round(columnWidth * ratio)
}

/** Lay out `items` in reading order into the shortest column. Deterministic. */
export function layoutMasonry(items: readonly MasonryInput[], options: MasonryOptions): MasonryLayout {
  const columns = columnCount(options.containerWidth, options.minColumnWidth, options.gap)
  const columnWidth =
    columns === 1
      ? Math.max(0, options.containerWidth)
      : Math.floor((options.containerWidth - options.gap * (columns - 1)) / columns)
  const heights = new Array<number>(columns).fill(0)
  const rects: Record<string, MasonryRect> = {}
  const order: string[] = []

  for (const item of items) {
    let column = 0
    for (let c = 1; c < columns; c++) {
      if ((heights[c] ?? 0) < (heights[column] ?? 0)) column = c
    }
    const body = bodyHeight(item, columnWidth, options.minRatio, options.maxRatio)
    const h = body + (item.captionHeight ?? options.captionHeight)
    const y = heights[column] ?? 0
    rects[item.id] = { x: column * (columnWidth + options.gap), y, w: columnWidth, h, column }
    heights[column] = y + h + options.gap
    order.push(item.id)
  }

  const height = Math.max(0, Math.max(...heights, 0) - options.gap)
  return { columns, columnWidth, height, rects, order }
}

export type Direction = 'up' | 'down' | 'left' | 'right'

/**
 * Nearest card in a direction, by centre distance with a strong bias along the axis of travel.
 * Returns null when nothing lies in that direction.
 */
export function nearestInDirection(layout: MasonryLayout, fromId: string, direction: Direction): string | null {
  const from = layout.rects[fromId]
  if (!from) return null
  const fx = from.x + from.w / 2
  const fy = from.y + from.h / 2
  let best: string | null = null
  let bestScore = Number.POSITIVE_INFINITY

  for (const id of layout.order) {
    if (id === fromId) continue
    const r = layout.rects[id]
    if (!r) continue
    const cx = r.x + r.w / 2
    const cy = r.y + r.h / 2
    const dx = cx - fx
    const dy = cy - fy
    let primary: number
    let secondary: number
    switch (direction) {
      case 'up':
        primary = -dy
        secondary = Math.abs(dx)
        break
      case 'down':
        primary = dy
        secondary = Math.abs(dx)
        break
      case 'left':
        primary = -dx
        secondary = Math.abs(dy)
        break
      case 'right':
        primary = dx
        secondary = Math.abs(dy)
        break
    }
    if (primary <= 0) continue
    // Same-column moves for up/down: prefer them strongly.
    const sameLane = direction === 'up' || direction === 'down' ? r.column === from.column : Math.abs(dy) < from.h / 2
    const score = primary + secondary * (sameLane ? 0.25 : 3)
    if (score < bestScore) {
      bestScore = score
      best = id
    }
  }
  return best
}
