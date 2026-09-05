/**
 * When the shelf is on screen, and who put it there. Pure state machine, no Electron imports, so
 * it can run under Vitest; `desktop/windows.ts` owns the windows and the timers.
 *
 * Two kinds of visibility:
 * - **transient**: a drag opened the shelf. It goes away by itself once the drag is over, so a
 *   false positive costs the user nothing.
 * - **pinned**: the user asked for it (tray click, ⌘⇧K, menu). It stays until they dismiss it,
 *   and a drag passing by never takes it away.
 */

export type ShelfPresence = 'hidden' | 'transient' | 'pinned'

export type ShelfTrigger =
  /** A drag session began somewhere on the desktop. */
  | { kind: 'drag-start' }
  /** The drag ended; `kept` is true when it ended in a capture (dropped on the shelf or the tray). */
  | { kind: 'drag-end'; kept: boolean }
  | { kind: 'manual-show' }
  | { kind: 'manual-hide' }
  | { kind: 'manual-toggle' }
  /** The auto-hide delay handed back by a previous decision has elapsed. */
  | { kind: 'linger-elapsed' }

export interface ShelfDecision {
  presence: ShelfPresence
  action: 'show' | 'hide' | 'none'
  /** Hide the shelf in this many ms; `null` cancels any pending auto-hide. */
  hideAfterMs: number | null
}

/** The drag ended somewhere else: get out of the way, but not so fast it looks like a glitch. */
export const SHELF_DISMISS_MS = 350

/** Something was kept: stay long enough to read the confirmation and see the tile. */
export const SHELF_LINGER_MS = 4000

const stay = (presence: ShelfPresence): ShelfDecision => ({ presence, action: 'none', hideAfterMs: null })

export function nextShelfState(presence: ShelfPresence, trigger: ShelfTrigger): ShelfDecision {
  switch (trigger.kind) {
    case 'drag-start':
      // Already up (pinned or from an earlier drag): leave it alone, just cancel any pending hide.
      return presence === 'hidden' ? { presence: 'transient', action: 'show', hideAfterMs: null } : stay(presence)

    case 'drag-end':
      if (presence !== 'transient') return stay(presence)
      return {
        presence: 'transient',
        action: 'none',
        hideAfterMs: trigger.kept ? SHELF_LINGER_MS : SHELF_DISMISS_MS
      }

    case 'manual-show':
      return { presence: 'pinned', action: 'show', hideAfterMs: null }

    case 'manual-hide':
      return { presence: 'hidden', action: 'hide', hideAfterMs: null }

    case 'manual-toggle':
      return nextShelfState(presence, { kind: presence === 'hidden' ? 'manual-show' : 'manual-hide' })

    case 'linger-elapsed':
      // A shelf the user pinned in the meantime must survive a timer from before.
      return presence === 'transient' ? { presence: 'hidden', action: 'hide', hideAfterMs: null } : stay(presence)
  }
}
