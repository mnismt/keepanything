import { describe, expect, it } from 'vitest'
import { shelfOutline } from '../../src/renderer/src/lib/shelf-outline'
import { SHELF, SHELF_WINDOW } from '../../src/shared/layout'

describe('shelfOutline', () => {
  it('starts and ends on the right edge, spanning the full window height', () => {
    const d = shelfOutline('right', false)
    expect(d.startsWith(`M ${SHELF_WINDOW.width} 0`)).toBe(true)
    expect(d.endsWith(`${SHELF_WINDOW.width} ${SHELF_WINDOW.height}`)).toBe(true)
  })

  it('mirrors to the left edge and leaves the shadow margin on the inner side', () => {
    const d = shelfOutline('left', false)
    expect(d.startsWith('M 0 0')).toBe(true)
    expect(d).toContain(`L ${SHELF_WINDOW.width - SHELF.shadow} `)
    expect(d).not.toContain(`L ${SHELF.shadow} `)
  })

  it('only the fill variant is closed', () => {
    expect(shelfOutline('right', true).endsWith('Z')).toBe(true)
    expect(shelfOutline('right', false).endsWith('Z')).toBe(false)
  })
})
