import * as stylex from '@stylexjs/stylex'
import {
  type DragEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type { ItemSummary } from '../../../../../shared/types'
import { templateFromMenuAction } from '../../../lib/commands'
import { setInternalDrag } from '../../../lib/dnd'
import { ago, count, secondaryLine } from '../../../lib/format'
import { invoke } from '../../../lib/ipc-client'
import { addToCollection, removeFromCollection, startSelectionCommand } from '../../../lib/library-actions'
import { layoutMasonry, type MasonryLayout } from '../../../lib/masonry'
import { type Density, useLibrary } from '../../../state/library'
import { useToasts } from '../../../state/toasts'
import { useUi } from '../../../state/ui'
import { shared } from '../../../styles/shared'
import { Thumb } from '../../common'
import { ItemCard } from '../item-card'
import { styles } from './styles'

export const CAPTION_HEIGHT = 44
const GAP = 14
const MIN_COL: Record<Density, number> = { comfortable: 220, compact: 168 }

export interface MasonryGridProps {
  items: ItemSummary[]
  /** Lets the parent know the current layout for keyboard navigation. */
  onLayout?: (layout: MasonryLayout) => void
}

/** Container width via ResizeObserver. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = (): void => setWidth(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

interface CardHandlers {
  onSelect: (item: ItemSummary, e: MouseEvent) => void
  onOpen: (item: ItemSummary) => void
  onContextMenu: (item: ItemSummary, e: MouseEvent) => void
  onDragStart: (item: ItemSummary, e: DragEvent) => void
  onFocus: (item: ItemSummary) => void
  onRetry: (item: ItemSummary) => void
  onQuickAction: (item: ItemSummary) => void
  onRemoveFromCollection?: (item: ItemSummary) => void
}

/** Shared interaction handlers for cards and rows. */
function useCardHandlers(): CardHandlers {
  const select = useLibrary((s) => s.select)
  const setFocus = useLibrary((s) => s.setFocus)
  const openDetail = useUi((s) => s.openDetail)
  const push = useToasts((s) => s.push)
  const collectionId = useLibrary((s) => (s.query.view === 'collection' ? s.query.collectionId : null))

  const onSelect = useCallback(
    (item: ItemSummary, e: MouseEvent) => {
      const mode = e.shiftKey ? 'range' : e.metaKey || e.ctrlKey ? 'toggle' : 'replace'
      select(item.id, mode)
    },
    [select]
  )
  const onOpen = useCallback((item: ItemSummary) => openDetail(item.id, item.id), [openDetail])
  const onContextMenu = useCallback(
    async (item: ItemSummary, _e: MouseEvent) => {
      const { selection } = useLibrary.getState()
      const ids = selection.has(item.id) && selection.size > 1 ? [...selection] : [item.id]
      if (!selection.has(item.id)) select(item.id, 'replace')
      const result = await invoke('system:contextMenu', {
        kind: ids.length > 1 ? 'items' : 'item',
        ids,
        ...(collectionId ? { collectionId } : {})
      })
      if (!result.ok || !result.data.action) return
      await handleMenuAction(result.data.action, ids, item, collectionId)
    },
    [select, collectionId]
  )
  const onDragStart = useCallback((item: ItemSummary, e: DragEvent) => {
    const { selection } = useLibrary.getState()
    const ids = selection.has(item.id) ? [...selection] : [item.id]
    setInternalDrag(e.dataTransfer, ids)
  }, [])
  const onFocus = useCallback((item: ItemSummary) => setFocus(item.id), [setFocus])
  const onRetry = useCallback(
    async (item: ItemSummary) => {
      const ok = await useLibrary.getState().reprocess(item.id)
      push({ text: ok ? 'Trying again.' : "Couldn't retry right now." })
    },
    [push]
  )
  const onQuickAction = useCallback((item: ItemSummary) => {
    if (item.type === 'url') void invoke('items:openUrl', { id: item.id })
    else void invoke('items:quickLook', { id: item.id })
  }, [])
  const onRemoveFromCollection = useCallback(
    (item: ItemSummary) => {
      if (collectionId) void removeFromCollection(collectionId, [item.id])
    },
    [collectionId]
  )
  return {
    onSelect,
    onOpen,
    onContextMenu: (i, e) => void onContextMenu(i, e),
    onDragStart,
    onFocus,
    onRetry: (i) => void onRetry(i),
    onQuickAction,
    ...(collectionId ? { onRemoveFromCollection } : {})
  }
}

/** Mapping of native menu action ids (`main/desktop/context-menu.ts`) to renderer behaviour. */
export async function handleMenuAction(
  action: string,
  ids: string[],
  item: ItemSummary,
  collectionId: string | null = null
): Promise<void> {
  const lib = useLibrary.getState()
  const ui = useUi.getState()
  const toasts = useToasts.getState()
  const template = templateFromMenuAction(action)
  if (template) {
    await startSelectionCommand(template, ids)
    return
  }
  if (action.startsWith('add-to-collection:')) {
    await addToCollection(action.slice('add-to-collection:'.length), ids)
    return
  }
  switch (action) {
    case 'open':
    case 'detail':
      ui.openDetail(item.id, item.id)
      return
    case 'trash': {
      const ok = await lib.trash(ids)
      if (ok)
        toasts.push({
          text: ids.length === 1 ? 'Moved to Trash.' : `Moved ${ids.length} items to Trash.`,
          action: { label: 'Undo', run: () => lib.restore(ids) }
        })
      return
    }
    case 'restore': {
      const ok = await lib.restore(ids)
      if (ok) toasts.push({ text: ids.length === 1 ? 'Restored.' : `Restored ${ids.length} items.` })
      return
    }
    case 'deleteForever':
    case 'delete-forever':
      await lib.deleteForever(ids)
      return
    case 'openOriginal':
      await invoke('items:openOriginal', { id: item.id })
      return
    case 'reveal':
    case 'revealInFinder':
      await invoke('items:revealInFinder', { id: item.id })
      return
    case 'quickLook':
    case 'quick-look':
      await invoke('items:quickLook', { id: item.id })
      return
    case 'openUrl':
    case 'open-url':
      await invoke('items:openUrl', { id: item.id })
      return
    case 'copy-link':
      if (item.url) {
        await navigator.clipboard.writeText(item.url)
        toasts.push({ text: 'Link copied.' })
      }
      return
    case 'reprocess':
      await lib.reprocess(item.id)
      toasts.push({ text: 'Trying again.' })
      return
    case 'remove-from-collection':
      if (collectionId) await removeFromCollection(collectionId, ids)
      return
    case 'new-collection':
      ui.push({ kind: 'dialog', id: 'newCollection' })
      return
    case 'select-all':
      lib.selectAll()
      return
    default:
      return
  }
}

function Section({
  items,
  width,
  density,
  onLayout
}: {
  items: ItemSummary[]
  width: number
  density: Density
  onLayout?: (l: MasonryLayout) => void
}): React.JSX.Element {
  const selection = useLibrary((s) => s.selection)
  const focusId = useLibrary((s) => s.focusId)
  const handlers = useCardHandlers()
  const seen = useRef<Set<string>>(new Set())

  const layout = useMemo(
    () =>
      layoutMasonry(
        items.map((i) => ({ id: i.id, type: i.type, width: i.width, height: i.height })),
        { containerWidth: width, minColumnWidth: MIN_COL[density], gap: GAP, captionHeight: CAPTION_HEIGHT }
      ),
    [items, width, density]
  )

  useEffect(() => {
    onLayout?.(layout)
  }, [layout, onLayout])

  const entering = new Set<string>()
  for (const i of items) if (!seen.current.has(i.id)) entering.add(i.id)
  useEffect(() => {
    for (const i of items) seen.current.add(i.id)
  }, [items])

  const effectiveFocus = focusId && layout.rects[focusId] ? focusId : (items[0]?.id ?? null)

  return (
    <div
      {...stylex.props(styles.canvas, styles.canvasHeight(layout.height))}
      data-grid-canvas
      role="listbox"
      aria-multiselectable="true"
      aria-label="Items"
    >
      {width > 0
        ? items.map((item) => {
            const r = layout.rects[item.id]
            if (!r) return null
            return (
              <ItemCard
                key={item.id}
                item={item}
                x={r.x}
                y={r.y}
                w={r.w}
                h={r.h}
                captionHeight={CAPTION_HEIGHT}
                selected={selection.has(item.id)}
                focused={effectiveFocus === item.id}
                multi={selection.size > 1}
                entering={entering.has(item.id)}
                {...handlers}
              />
            )
          })
        : null}
    </div>
  )
}

function ListRows({ items }: { items: ItemSummary[] }): React.JSX.Element {
  const selection = useLibrary((s) => s.selection)
  const focusId = useLibrary((s) => s.focusId)
  const handlers = useCardHandlers()
  return (
    <div {...stylex.props(styles.list)} role="listbox" aria-multiselectable="true" aria-label="Items">
      {items.map((item) => (
        <div
          key={item.id}
          {...stylex.props(styles.row, selection.has(item.id) && styles.rowSelected)}
          role="option"
          aria-selected={selection.has(item.id)}
          tabIndex={(focusId ?? items[0]?.id) === item.id ? 0 : -1}
          data-item-id={item.id}
          draggable
          onDragStart={(e) => handlers.onDragStart(item, e)}
          onClick={(e) => handlers.onSelect(item, e)}
          onDoubleClick={() => handlers.onOpen(item)}
          onContextMenu={(e) => {
            e.preventDefault()
            handlers.onContextMenu(item, e)
          }}
          onFocus={() => handlers.onFocus(item)}
        >
          <span {...stylex.props(styles.rowThumb)}>
            <Thumb src={item.thumbnailUrl} fill={item.dominantColor} alt="" />
          </span>
          <span {...stylex.props(styles.rowText)}>
            <span {...stylex.props(styles.rowTitle, shared.ellipsis)}>{item.title}</span>
            <span {...stylex.props(styles.rowSecondary, shared.ellipsis)}>{secondaryLine(item)}</span>
          </span>
          <span {...stylex.props(styles.rowMeta)}>{ago(item.capturedAt)}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * JS-positioned columns from `layoutMasonry`; ResizeObserver reflow; list mode.
 * Keyboard navigation is handled by `useShellKeys` using the layout reported through `onLayout`.
 */
export function MasonryGrid({ items, onLayout }: MasonryGridProps): React.JSX.Element {
  const [ref, width] = useWidth<HTMLDivElement>()
  const density = useLibrary((s) => s.density)
  const layoutMode = useLibrary((s) => s.layout)
  const clearSelection = useLibrary((s) => s.clearSelection)

  const isBackground = (e: MouseEvent): boolean => {
    const t = e.target as HTMLElement
    return t === e.currentTarget || t.hasAttribute('data-grid-inner') || t.hasAttribute('data-grid-canvas')
  }

  const onBackgroundContext = async (e: MouseEvent): Promise<void> => {
    if (!isBackground(e)) return
    e.preventDefault()
    const result = await invoke('system:contextMenu', { kind: 'background', ids: [] })
    if (!result.ok || !result.data.action) return
    switch (result.data.action) {
      case 'new-collection':
        useUi.getState().push({ kind: 'dialog', id: 'newCollection' })
        return
      case 'select-all':
        useLibrary.getState().selectAll()
        return
      case 'add-files': {
        const chosen = await invoke('system:chooseFiles', undefined)
        if (chosen.ok && chosen.data.paths.length > 0) await invoke('capture:files', { paths: chosen.data.paths })
        return
      }
      default:
        return
    }
  }

  return (
    <div
      {...stylex.props(styles.scroller)}
      data-grid-root
      onClick={(e) => isBackground(e) && clearSelection()}
      onContextMenu={(e) => void onBackgroundContext(e)}
    >
      <div ref={ref} {...stylex.props(styles.inner)} data-grid-inner>
        {layoutMode === 'list' ? (
          <ListRows items={items} />
        ) : (
          <Section items={items} width={width} density={density} onLayout={onLayout} />
        )}
      </div>
    </div>
  )
}
