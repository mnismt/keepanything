import { describe, expect, it } from 'vitest'
import { parseDragWatchLine } from '../../src/main/desktop/drag-watch'
import { containsPoint } from '../../src/main/positioning'
import { nextShelfState, SHELF_DISMISS_MS, SHELF_LINGER_MS, type ShelfPresence } from '../../src/main/shelf-policy'

describe('nextShelfState', () => {
  it('a drag opens the shelf transiently', () => {
    expect(nextShelfState('hidden', { kind: 'drag-start' })).toEqual({
      presence: 'transient',
      action: 'show',
      hideAfterMs: null
    })
  })

  it('a second drag while the shelf is up only cancels the pending auto-hide', () => {
    for (const presence of ['transient', 'pinned'] as ShelfPresence[]) {
      expect(nextShelfState(presence, { kind: 'drag-start' })).toEqual({
        presence,
        action: 'none',
        hideAfterMs: null
      })
    }
  })

  it('a drag that ends elsewhere hides the shelf shortly after', () => {
    expect(nextShelfState('transient', { kind: 'drag-end', kept: false })).toEqual({
      presence: 'transient',
      action: 'none',
      hideAfterMs: SHELF_DISMISS_MS
    })
  })

  it('a drag that kept something leaves the receipt on screen for longer', () => {
    expect(nextShelfState('transient', { kind: 'drag-end', kept: true })).toEqual({
      presence: 'transient',
      action: 'none',
      hideAfterMs: SHELF_LINGER_MS
    })
  })

  it('a shelf the user opened is never taken away by a passing drag', () => {
    expect(nextShelfState('pinned', { kind: 'drag-end', kept: false })).toEqual({
      presence: 'pinned',
      action: 'none',
      hideAfterMs: null
    })
    expect(nextShelfState('pinned', { kind: 'linger-elapsed' })).toEqual({
      presence: 'pinned',
      action: 'none',
      hideAfterMs: null
    })
  })

  it('drag-end on a hidden shelf does nothing', () => {
    expect(nextShelfState('hidden', { kind: 'drag-end', kept: true })).toEqual({
      presence: 'hidden',
      action: 'none',
      hideAfterMs: null
    })
  })

  it('the linger timer only closes a shelf that a drag opened', () => {
    expect(nextShelfState('transient', { kind: 'linger-elapsed' })).toEqual({
      presence: 'hidden',
      action: 'hide',
      hideAfterMs: null
    })
    expect(nextShelfState('hidden', { kind: 'linger-elapsed' }).action).toBe('none')
  })

  it('toggling pins the shelf, and pins survive drags', () => {
    const opened = nextShelfState('hidden', { kind: 'manual-toggle' })
    expect(opened).toEqual({ presence: 'pinned', action: 'show', hideAfterMs: null })
    expect(nextShelfState(opened.presence, { kind: 'manual-toggle' })).toEqual({
      presence: 'hidden',
      action: 'hide',
      hideAfterMs: null
    })
  })

  it('toggling a shelf a drag opened closes it', () => {
    expect(nextShelfState('transient', { kind: 'manual-toggle' })).toEqual({
      presence: 'hidden',
      action: 'hide',
      hideAfterMs: null
    })
  })

  it('opening by hand upgrades a transient shelf to pinned', () => {
    expect(nextShelfState('transient', { kind: 'manual-show' })).toEqual({
      presence: 'pinned',
      action: 'show',
      hideAfterMs: null
    })
  })
})

describe('containsPoint', () => {
  const rect = { x: 100, y: 50, width: 300, height: 190 }

  it('includes the top-left edge and excludes the far edges', () => {
    expect(containsPoint(rect, { x: 100, y: 50 })).toBe(true)
    expect(containsPoint(rect, { x: 399, y: 239 })).toBe(true)
    expect(containsPoint(rect, { x: 400, y: 239 })).toBe(false)
    expect(containsPoint(rect, { x: 399, y: 240 })).toBe(false)
    expect(containsPoint(rect, { x: 99, y: 100 })).toBe(false)
  })

  it('an empty rect contains nothing', () => {
    expect(containsPoint({ x: 0, y: 0, width: 0, height: 0 }, { x: 0, y: 0 })).toBe(false)
  })
})

describe('parseDragWatchLine', () => {
  it('reads the sidecar protocol', () => {
    expect(parseDragWatchLine('{"event":"ready"}')).toEqual({ event: 'ready' })
    expect(parseDragWatchLine('{"event":"drag-end"}\r')).toEqual({ event: 'drag-end' })
    expect(parseDragWatchLine('{"event":"drag-start","types":["public.file-url"],"folders":2}')).toEqual({
      event: 'drag-start',
      types: ['public.file-url'],
      folders: 2
    })
  })

  it('keeps drag-start usable when types are missing or junk', () => {
    expect(parseDragWatchLine('{"event":"drag-start"}')).toEqual({ event: 'drag-start', types: [], folders: 0 })
    expect(parseDragWatchLine('{"event":"drag-start","types":[1,"ok",null]}')).toEqual({
      event: 'drag-start',
      types: ['ok'],
      folders: 0
    })
  })

  it('ignores blank lines, malformed JSON and unknown events', () => {
    for (const line of ['', '   ', 'not json', '[]', 'null', '{"event":"boom"}', '{"types":[]}']) {
      expect(parseDragWatchLine(line)).toBeNull()
    }
  })
})
