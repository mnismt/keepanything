/**
 * Global keydown -> shell actions, scoped by focus zone. One listener at the App root.
 */
import { useEffect, useRef } from 'react'
import { invoke, platform } from '../lib/ipc-client'
import { matchBinding, resolveZone, SHELL_BINDINGS } from '../lib/keyboard'
import type { MasonryLayout } from '../lib/masonry'
import { nearestInDirection } from '../lib/masonry'
import { useLibrary } from '../state/library'
import { useToasts } from '../state/toasts'
import { useUi } from '../state/ui'

function inTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

function focusCard(id: string): void {
  const el = document.querySelector<HTMLElement>(`[data-item-id="${id}"]`)
  el?.focus({ preventScroll: false })
  el?.scrollIntoView({ block: 'nearest' })
}

export function useShellKeys(layoutRef: React.RefObject<MasonryLayout | null>): void {
  const plat = useRef(platform())
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const ui = useUi.getState()
      const lib = useLibrary.getState()
      const zone = resolveZone({ inTextField: inTextField(e.target), sheetOpen: ui.modalStack.length > 0 })
      const action = matchBinding(e, zone, SHELL_BINDINGS, plat.current)
      if (!action) return

      const layout = layoutRef.current
      const current = lib.focusId ?? lib.order[0] ?? null
      const moveTo = (id: string | null, extend: boolean): void => {
        if (!id) return
        if (extend) lib.select(id, 'range')
        else lib.select(id, 'replace')
        lib.setFocus(id)
        focusCard(id)
      }
      const dir = (a: string): 'up' | 'down' | 'left' | 'right' | null =>
        a.endsWith('Up') || a === 'grid.up'
          ? 'up'
          : a.endsWith('Down') || a === 'grid.down'
            ? 'down'
            : a.endsWith('Left') || a === 'grid.left'
              ? 'left'
              : a.endsWith('Right') || a === 'grid.right'
                ? 'right'
                : null

      switch (action) {
        case 'palette.toggle':
          e.preventDefault()
          ui.togglePalette()
          return
        case 'settings.open':
          e.preventDefault()
          ui.openSettings()
          return
        case 'undo':
          if (useToasts.getState().undoNewest()) e.preventDefault()
          return
        case 'escape':
          if (ui.modalStack.length > 0) {
            const top = ui.pop()
            if (top?.kind === 'detail' && top.originId) requestAnimationFrame(() => focusCard(top.originId as string))
          } else if (lib.selection.size > 0) lib.clearSelection()
          return
        case 'grid.up':
        case 'grid.down':
        case 'grid.left':
        case 'grid.right':
        case 'grid.extendUp':
        case 'grid.extendDown':
        case 'grid.extendLeft':
        case 'grid.extendRight': {
          if (!current) return
          e.preventDefault()
          const d = dir(action)
          if (!d) return
          if (lib.layout === 'list') {
            const idx = lib.order.indexOf(current)
            const next = d === 'up' || d === 'left' ? lib.order[idx - 1] : lib.order[idx + 1]
            moveTo(next ?? null, action.startsWith('grid.extend'))
            return
          }
          if (!layout) return
          if (!layout.rects[current]) {
            moveTo(layout.order[0] ?? null, false)
            return
          }
          moveTo(nearestInDirection(layout, current, d), action.startsWith('grid.extend'))
          return
        }
        case 'grid.home':
          e.preventDefault()
          moveTo(lib.order[0] ?? null, e.shiftKey)
          return
        case 'grid.end':
          e.preventDefault()
          moveTo(lib.order[lib.order.length - 1] ?? null, e.shiftKey)
          return
        case 'grid.open':
          if (!current) return
          e.preventDefault()
          ui.openDetail(current, current)
          return
        case 'grid.quickLook':
          if (!current) return
          e.preventDefault()
          void invoke('items:quickLook', { id: current })
          return
        case 'grid.selectAll':
          e.preventDefault()
          lib.selectAll()
          return
        case 'grid.trash': {
          const ids = lib.selection.size > 0 ? [...lib.selection] : current ? [current] : []
          if (ids.length === 0) return
          e.preventDefault()
          if (lib.query.view === 'trash') return
          void lib.trash(ids).then((ok) => {
            if (ok)
              useToasts.getState().push({
                text: ids.length === 1 ? 'Moved to Trash.' : `Moved ${ids.length} items to Trash.`,
                action: { label: 'Undo', run: () => lib.restore(ids) }
              })
          })
          return
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [layoutRef])
}
