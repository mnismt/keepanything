/**
 * Focus-zone scoped key map, pure (no DOM types) so it is unit-testable under node.
 * A binding fires only when the active zone is listed. Zones: `grid` (library content has focus),
 * `input` (a text field), `sheet` (detail / dialog / palette open), `global` (matches everywhere).
 */
export type FocusZone = 'grid' | 'input' | 'sheet' | 'global'

/** The subset of KeyboardEvent the matcher needs. */
export interface KeyLike {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
}

export interface KeyBinding<A extends string = string> {
  action: A
  key: string
  meta?: boolean
  shift?: boolean
  alt?: boolean
  /** Zones where the binding is active. `global` = any zone. */
  zones: readonly FocusZone[]
}

export type ShellAction =
  | 'palette.toggle'
  | 'settings.open'
  | 'escape'
  | 'grid.up'
  | 'grid.down'
  | 'grid.left'
  | 'grid.right'
  | 'grid.extendUp'
  | 'grid.extendDown'
  | 'grid.extendLeft'
  | 'grid.extendRight'
  | 'grid.home'
  | 'grid.end'
  | 'grid.open'
  | 'grid.quickLook'
  | 'grid.trash'
  | 'grid.selectAll'
  | 'undo'

/** Default shell bindings. `meta` means ⌘ on macOS (Ctrl elsewhere). */
export const SHELL_BINDINGS: readonly KeyBinding<ShellAction>[] = [
  { action: 'palette.toggle', key: 'k', meta: true, zones: ['global'] },
  { action: 'settings.open', key: ',', meta: true, zones: ['global'] },
  { action: 'undo', key: 'z', meta: true, zones: ['grid', 'sheet'] },
  { action: 'escape', key: 'Escape', zones: ['grid', 'sheet'] },
  { action: 'grid.extendUp', key: 'ArrowUp', shift: true, zones: ['grid'] },
  { action: 'grid.extendDown', key: 'ArrowDown', shift: true, zones: ['grid'] },
  { action: 'grid.extendLeft', key: 'ArrowLeft', shift: true, zones: ['grid'] },
  { action: 'grid.extendRight', key: 'ArrowRight', shift: true, zones: ['grid'] },
  { action: 'grid.up', key: 'ArrowUp', zones: ['grid'] },
  { action: 'grid.down', key: 'ArrowDown', zones: ['grid'] },
  { action: 'grid.left', key: 'ArrowLeft', zones: ['grid'] },
  { action: 'grid.right', key: 'ArrowRight', zones: ['grid'] },
  { action: 'grid.home', key: 'Home', zones: ['grid'] },
  { action: 'grid.end', key: 'End', zones: ['grid'] },
  { action: 'grid.open', key: 'Enter', zones: ['grid'] },
  { action: 'grid.quickLook', key: ' ', zones: ['grid'] },
  { action: 'grid.trash', key: 'Backspace', zones: ['grid'] },
  { action: 'grid.trash', key: 'Delete', zones: ['grid'] },
  { action: 'grid.selectAll', key: 'a', meta: true, zones: ['grid'] }
]

function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key
}

/**
 * First binding matching `event` in `zone`. Modifier flags must match exactly (a binding without
 * `meta` does not fire while ⌘ is held), so plain arrows and ⌘-chords never collide.
 */
export function matchBinding<A extends string>(
  event: KeyLike,
  zone: FocusZone,
  bindings: readonly KeyBinding<A>[],
  platform: 'darwin' | 'other' = 'darwin'
): A | null {
  const metaHeld = platform === 'darwin' ? Boolean(event.metaKey) : Boolean(event.ctrlKey)
  const key = normalizeKey(event.key)
  for (const b of bindings) {
    if (!b.zones.includes('global') && !b.zones.includes(zone)) continue
    if (normalizeKey(b.key) !== key) continue
    if (Boolean(b.meta) !== metaHeld) continue
    if (Boolean(b.shift) !== Boolean(event.shiftKey)) continue
    if (Boolean(b.alt) !== Boolean(event.altKey)) continue
    return b.action
  }
  return null
}

/** Zone resolution from facts the caller already knows (kept pure; the DOM hook computes them). */
export function resolveZone(facts: { inTextField: boolean; sheetOpen: boolean }): FocusZone {
  if (facts.inTextField) return 'input'
  if (facts.sheetOpen) return 'sheet'
  return 'grid'
}
