import * as stylex from '@stylexjs/stylex'
import { Check, Eye, X } from 'lucide-react'
import { type DragEvent, useEffect, useRef, useState } from 'react'
import { COPY } from '../../../../../shared/constants'
import { isFailed, isTerminal, STATUS_LABEL } from '../../../../../shared/status'
import type { ItemSummary } from '../../../../../shared/types'
import { hasExternalPayload, isInternalDrag, setInternalDrag, snapshotDrop } from '../../../lib/dnd'
import { ago } from '../../../lib/format'
import { getPathForFile, invoke, on } from '../../../lib/ipc-client'
import { shared } from '../../../styles/shared'
import { Dot, Thumb, toneForStatus } from '../../common'
import { styles } from './styles'

const MAX_TILES = 12

/**
 * ShelfView (`?view=shelf`): a Yoink-like strip. Things dropped here are kept immediately and
 * stay as compact tiles until cleared. Tiles are draggable (internal item drag) and can be
 * Quick-Looked; the strip follows `items:changed` so status settles in place.
 */
export function ShelfView(): React.JSX.Element {
  const [items, setItems] = useState<ItemSummary[]>([])
  const [over, setOver] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const say = (message: string): void => {
    setFlash(message)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(null), 1600)
  }

  useEffect(() => {
    const offDropped = on('shelf:dropped', ({ result }) => {
      const ids = result.items.map((i) => i.existingId ?? i.id)
      if (ids.length === 0) return
      void invoke('items:list', { view: 'library', sort: 'captured', limit: 40 }).then((r) => {
        if (!r.ok) return
        const fresh = ids.map((id) => r.data.find((i) => i.id === id)).filter((i): i is ItemSummary => Boolean(i))
        setItems((prev) => {
          const map = new Map(prev.map((i) => [i.id, i]))
          for (const f of fresh) map.set(f.id, f)
          return [...map.values()]
            .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))
            .slice(0, MAX_TILES)
        })
      })
    })
    const offChanged = on('items:changed', (event) => {
      setItems((prev) => {
        if (prev.length === 0) return prev
        const map = new Map(prev.map((i) => [i.id, i]))
        for (const s of event.summaries ?? []) if (map.has(s.id)) map.set(s.id, s)
        if (event.reason === 'trashed' || event.reason === 'deleted') for (const id of event.ids) map.delete(id)
        return [...map.values()]
      })
    })
    return () => {
      offDropped()
      offChanged()
    }
  }, [])

  const onDrop = async (e: DragEvent): Promise<void> => {
    e.preventDefault()
    setOver(false)
    if (isInternalDrag(e.dataTransfer)) return
    const request = snapshotDrop(e.dataTransfer, getPathForFile, 'shelf')
    const result = await invoke('capture:drop', request)
    if (!result.ok) {
      say(COPY.cantReadPage)
      return
    }
    const created = result.data.items.filter((i) => i.status === 'created').length
    const dupes = result.data.items.length - created
    say(created === 0 && dupes > 0 ? 'Already kept.' : created > 1 ? `Saved ${created}.` : COPY.saved)
  }

  const onDragStart = (item: ItemSummary, e: DragEvent): void => {
    setInternalDrag(e.dataTransfer, [item.id])
  }

  return (
    <div
      {...stylex.props(styles.shelf, over && styles.shelfOver)}
      onDragOver={(e) => {
        if (isInternalDrag(e.dataTransfer) || !hasExternalPayload(e.dataTransfer)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => void onDrop(e)}
    >
      <div {...stylex.props(styles.drag, shared.drag)}>
        {flash ? (
          <span {...stylex.props(styles.flash)}>
            <Check size={12} strokeWidth={2} /> {flash}
          </span>
        ) : items.length > 0 ? (
          <button type="button" {...stylex.props(styles.clear, shared.noDrag)} onClick={() => setItems([])}>
            <X size={11} strokeWidth={1.5} />
            Clear
          </button>
        ) : null}
      </div>
      <div {...stylex.props(styles.target, over && styles.targetOver)} aria-label="Drop target">
        {over ? (
          'Let go to keep it'
        ) : items.length === 0 ? (
          <span {...stylex.props(styles.targetHero)}>{COPY.dropHere}</span>
        ) : (
          COPY.dropHint
        )}
      </div>
      <div {...stylex.props(styles.list)} aria-label="Kept from the shelf">
        {items.length === 0 ? (
          <p {...stylex.props(styles.empty)}>
            Drop files, links or text here while you work. They land in your library right away.
          </p>
        ) : null}
        {items.map((i) => {
          const working = !isTerminal(i.processingStatus)
          return (
            <div
              key={i.id}
              {...stylex.props(styles.tile, styles.tileFocus, stylex.defaultMarker())}
              draggable
              onDragStart={(e) => onDragStart(i, e)}
              onDoubleClick={() => void invoke('items:quickLook', { id: i.id })}
              title="Drag into a collection, or double-click to Quick Look"
              tabIndex={0}
            >
              <span {...stylex.props(styles.thumb)}>
                <Thumb src={i.thumbnailUrl} fill={i.dominantColor} />
              </span>
              <span {...stylex.props(styles.text)}>
                <span {...stylex.props(styles.title, shared.ellipsis)}>{i.title}</span>
                <span {...stylex.props(styles.sub)}>
                  {working || isFailed(i.processingStatus) ? <Dot tone={toneForStatus(i.processingStatus)} /> : null}
                  <span {...stylex.props(shared.ellipsis)}>
                    {working || isFailed(i.processingStatus)
                      ? STATUS_LABEL[i.processingStatus]
                      : `Kept ${ago(i.capturedAt)}`}
                  </span>
                </span>
              </span>
              <button
                type="button"
                {...stylex.props(styles.peek)}
                aria-label="Quick Look"
                onClick={() => void invoke(i.type === 'url' ? 'items:openUrl' : 'items:quickLook', { id: i.id })}
              >
                <Eye size={12} strokeWidth={1.5} />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
