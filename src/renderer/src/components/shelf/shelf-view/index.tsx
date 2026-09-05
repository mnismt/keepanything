import * as stylex from '@stylexjs/stylex'
import {
  AlignLeft,
  Check,
  Eye,
  File,
  FileText,
  Folder,
  Image,
  Layers,
  Link,
  type LucideIcon,
  Music,
  Video,
  X
} from 'lucide-react'
import { type DragEvent, useEffect, useRef, useState } from 'react'
import { COPY } from '../../../../../shared/constants'
import { SHELF, type ShelfEdge } from '../../../../../shared/layout'
import { isFailed, isTerminal, STATUS_LABEL } from '../../../../../shared/status'
import type { ItemSummary } from '../../../../../shared/types'
import { hasExternalPayload, isInternalDrag, setInternalDrag, snapshotDrop } from '../../../lib/dnd'
import { type DragPeek, type DragPeekKind, dragPeekLabel, peekDrag } from '../../../lib/drag-peek'
import { ago } from '../../../lib/format'
import { getPathForFile, invoke, isMockBridge, on } from '../../../lib/ipc-client'
import { shelfOutline } from '../../../lib/shelf-outline'
import { shared } from '../../../styles/shared'
import { Dot, Thumb, toneForStatus } from '../../common'
import { styles } from './styles'

const MAX_TILES = 12

const PEEK_ICON: Record<DragPeekKind, LucideIcon> = {
  link: Link,
  pdf: FileText,
  image: Image,
  video: Video,
  audio: Music,
  text: AlignLeft,
  folder: Folder,
  file: File,
  mixed: Layers
}

/**
 * ShelfView (`?view=shelf`): a notch that grows out of the screen edge. Things dropped here are
 * kept immediately and stay as compact tiles until cleared. Tiles are draggable (internal item
 * drag) and can be Quick-Looked; the strip follows `items:changed` so status settles in place.
 * Main announces `shelf:presence` around every show and hide so the panel can slide in from the
 * edge, and slide back out before the window disappears.
 */
/**
 * Icon and label for what is hovering the shelf. A pair of different things shows both icons,
 * overlapped; anything else shows the one icon for the set. Keyed on the label so a drag that
 * changes shape (rare, but a multi-item drag can grow) replays the pop-in.
 */
function PeekBadge({ peek }: { peek: DragPeek }): React.JSX.Element {
  const label = dragPeekLabel(peek)
  const icons = peek.count === 2 && peek.parts.length === 2 ? peek.parts.map((p) => p.kind) : [peek.kind]
  return (
    <span key={label} {...stylex.props(styles.peekBadge)}>
      {icons.map((kind, i) => {
        const Icon = PEEK_ICON[kind]
        return (
          <span key={kind} {...stylex.props(styles.peekIcon, i > 0 && styles.peekIconStacked)}>
            <Icon size={18} strokeWidth={1.5} />
          </span>
        )
      })}
      <span {...stylex.props(styles.peekLabel)}>{label}</span>
    </span>
  )
}

export function ShelfView(): React.JSX.Element {
  const [items, setItems] = useState<ItemSummary[]>([])
  // The mock never announces presence, so a browser-only dev session shows the shelf straight away.
  const [visible, setVisible] = useState(() => isMockBridge())
  const [edge, setEdge] = useState<ShelfEdge>('right')
  const [over, setOver] = useState(false)
  /** What the drag hovering the shelf looks like; null until something is over it. */
  const [peek, setPeek] = useState<DragPeek | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const say = (message: string): void => {
    setFlash(message)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(null), 1600)
  }

  useEffect(() => {
    const offPresence = on('shelf:presence', (p) => {
      setEdge(p.edge)
      setVisible(p.visible)
      if (!p.visible) {
        setOver(false)
        setPeek(null)
      }
    })
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
      offPresence()
      offDropped()
      offChanged()
    }
  }, [])

  const onDrop = async (e: DragEvent): Promise<void> => {
    e.preventDefault()
    setOver(false)
    setPeek(null)
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

  const right = edge === 'right'
  return (
    <div
      {...stylex.props(styles.dock, visible ? styles.dockIn : right ? styles.dockOutRight : styles.dockOutLeft)}
      data-edge={edge}
      onDragOver={(e) => {
        if (isInternalDrag(e.dataTransfer) || !hasExternalPayload(e.dataTransfer)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setOver(true)
        const next = peekDrag(e.dataTransfer)
        setPeek((prev) =>
          prev &&
          next &&
          prev.kind === next.kind &&
          prev.count === next.count &&
          prev.parts.length === next.parts.length
            ? prev
            : next
        )
      }}
      onDragLeave={() => {
        setOver(false)
        setPeek(null)
      }}
      onDrop={(e) => void onDrop(e)}
    >
      <svg {...stylex.props(styles.shape)} aria-hidden="true" focusable="false">
        <path d={shelfOutline(edge, true)} {...stylex.props(styles.shapeFill)} />
        <path d={shelfOutline(edge, false)} {...stylex.props(styles.shapeLine, over && styles.shapeLineOver)} />
      </svg>
      <div
        {...stylex.props(
          styles.body(SHELF.fillet, SHELF.body.width),
          right ? styles.bodyRight : styles.bodyLeft,
          visible ? styles.bodyIn : right ? styles.bodyOutRight : styles.bodyOutLeft
        )}
      >
        <div {...stylex.props(styles.strip)}>
          {flash ? (
            <span key={flash} {...stylex.props(styles.flash)}>
              <Check size={12} strokeWidth={2} {...stylex.props(styles.flashIcon)} />
              {flash}
            </span>
          ) : items.length > 0 ? (
            <button type="button" {...stylex.props(shared.hoverFade, styles.clear)} onClick={() => setItems([])}>
              <X size={11} strokeWidth={1.5} />
              Clear
            </button>
          ) : null}
        </div>
        <div {...stylex.props(styles.target, over && styles.targetOver)} aria-label="Drop target">
          <svg {...stylex.props(styles.targetRing)} aria-hidden="true" focusable="false">
            <rect {...stylex.props(styles.targetRingRect, over && styles.targetRingRectOver)} />
          </svg>
          {over ? (
            <>
              <span key="over" {...stylex.props(styles.swapIn)}>
                Let go to keep it
              </span>
              {peek ? <PeekBadge peek={peek} /> : null}
            </>
          ) : items.length === 0 ? (
            <span key="hero" {...stylex.props(styles.targetHero, styles.swapIn)}>
              {COPY.dropHere}
            </span>
          ) : (
            <span key="hint" {...stylex.props(styles.swapIn)}>
              {COPY.dropHint}
            </span>
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
                {...stylex.props(shared.hoverFade, styles.tile, styles.tileFocus, stylex.defaultMarker())}
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
    </div>
  )
}
