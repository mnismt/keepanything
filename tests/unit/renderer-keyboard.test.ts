import { describe, expect, it } from 'vitest'
import { type KeyBinding, matchBinding, resolveZone, SHELL_BINDINGS } from '../../src/renderer/src/lib/keyboard'

describe('keyboard map scoping', () => {
  it('global bindings fire in every zone', () => {
    for (const zone of ['grid', 'input', 'sheet'] as const) {
      expect(matchBinding({ key: 'k', metaKey: true }, zone, SHELL_BINDINGS)).toBe('palette.toggle')
      expect(matchBinding({ key: ',', metaKey: true }, zone, SHELL_BINDINGS)).toBe('settings.open')
    }
  })

  it('grid bindings do not fire while typing or while a sheet is open', () => {
    expect(matchBinding({ key: 'ArrowDown' }, 'grid', SHELL_BINDINGS)).toBe('grid.down')
    expect(matchBinding({ key: 'ArrowDown' }, 'input', SHELL_BINDINGS)).toBeNull()
    expect(matchBinding({ key: 'ArrowDown' }, 'sheet', SHELL_BINDINGS)).toBeNull()
    expect(matchBinding({ key: 'Backspace' }, 'input', SHELL_BINDINGS)).toBeNull()
    expect(matchBinding({ key: 'Backspace' }, 'grid', SHELL_BINDINGS)).toBe('grid.trash')
    expect(matchBinding({ key: 'Delete' }, 'grid', SHELL_BINDINGS)).toBe('grid.trash')
  })

  it('modifiers must match exactly so ⌘A and A, ⇧↑ and ↑ never collide', () => {
    expect(matchBinding({ key: 'a', metaKey: true }, 'grid', SHELL_BINDINGS)).toBe('grid.selectAll')
    expect(matchBinding({ key: 'a' }, 'grid', SHELL_BINDINGS)).toBeNull()
    expect(matchBinding({ key: 'A', metaKey: true }, 'grid', SHELL_BINDINGS)).toBe('grid.selectAll')
    expect(matchBinding({ key: 'ArrowUp', shiftKey: true }, 'grid', SHELL_BINDINGS)).toBe('grid.extendUp')
    expect(matchBinding({ key: 'ArrowUp', altKey: true }, 'grid', SHELL_BINDINGS)).toBeNull()
  })

  it('Escape works in grid and sheet but is left to the field in input', () => {
    expect(matchBinding({ key: 'Escape' }, 'grid', SHELL_BINDINGS)).toBe('escape')
    expect(matchBinding({ key: 'Escape' }, 'sheet', SHELL_BINDINGS)).toBe('escape')
    expect(matchBinding({ key: 'Escape' }, 'input', SHELL_BINDINGS)).toBeNull()
  })

  it('Space triggers Quick Look only in the grid (not in detail or text fields)', () => {
    expect(matchBinding({ key: ' ' }, 'grid', SHELL_BINDINGS)).toBe('grid.quickLook')
    expect(matchBinding({ key: ' ' }, 'sheet', SHELL_BINDINGS)).toBeNull()
    expect(matchBinding({ key: ' ' }, 'input', SHELL_BINDINGS)).toBeNull()
  })

  it('uses Ctrl as the command key on other platforms', () => {
    expect(matchBinding({ key: 'k', ctrlKey: true }, 'grid', SHELL_BINDINGS, 'other')).toBe('palette.toggle')
    expect(matchBinding({ key: 'k', metaKey: true }, 'grid', SHELL_BINDINGS, 'other')).toBeNull()
  })

  it('custom binding tables work and the first match wins', () => {
    const table: KeyBinding<'a' | 'b'>[] = [
      { action: 'a', key: 'x', zones: ['grid'] },
      { action: 'b', key: 'x', zones: ['grid', 'sheet'] }
    ]
    expect(matchBinding({ key: 'x' }, 'grid', table)).toBe('a')
    expect(matchBinding({ key: 'x' }, 'sheet', table)).toBe('b')
  })

  it('resolves the zone: text field beats sheet beats grid', () => {
    expect(resolveZone({ inTextField: true, sheetOpen: true })).toBe('input')
    expect(resolveZone({ inTextField: false, sheetOpen: true })).toBe('sheet')
    expect(resolveZone({ inTextField: false, sheetOpen: false })).toBe('grid')
  })
})
