import * as stylex from '@stylexjs/stylex'
import { Plus, Settings } from 'lucide-react'
import { useReducedMotion } from 'motion/react'
import { type DragEvent, type ReactNode, useState } from 'react'
import type { CollectionSummary } from '../../../../../shared/types'
import { hasExternalPayload, isInternalDrag, readInternalDrag, snapshotDrop } from '../../../lib/dnd'
import { count } from '../../../lib/format'
import { getPathForFile, invoke } from '../../../lib/ipc-client'
import { useCollections } from '../../../state/collections'
import { useLibrary } from '../../../state/library'
import { useSettings } from '../../../state/settings'
import { useToasts } from '../../../state/toasts'
import { type Section, useUi } from '../../../state/ui'
import { shared } from '../../../styles/shared'
import { AnimatedSidebarIcon, type AnimatedSidebarIconName } from '../animated-icons'
import { LocalStatusFooter } from '../local-status-footer'
import { styles } from './styles'

interface RowProps {
  /** Either an icon name (renders the animated mark) or a custom node (e.g. the collection swatch). */
  icon?: AnimatedSidebarIconName | ReactNode
  label: string
  count?: number
  current: boolean
  onClick: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  /** Accept drops (internal items and external payloads) into this collection. */
  dropCollectionId?: string
}

function Row({
  icon,
  label,
  count: n,
  current,
  onClick,
  onContextMenu,
  dropCollectionId
}: RowProps): React.JSX.Element {
  const [over, setOver] = useState(false)
  const [active, setActive] = useState(false)
  // `useReducedMotion` returns `null` until the preference is known; coerce to `false` so the
  // first frame renders the animated mark rather than flash-falling to the static one.
  const reducedMotion = !!useReducedMotion()
  const addItems = useCollections((s) => s.addItems)

  const push = useToasts((s) => s.push)
  const collections = useCollections((s) => s.list)

  const onDragOver = (e: DragEvent): void => {
    if (!dropCollectionId) return
    if (!isInternalDrag(e.dataTransfer) && !hasExternalPayload(e.dataTransfer)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = isInternalDrag(e.dataTransfer) ? 'move' : 'copy'
    setOver(true)
  }
  const onDrop = async (e: DragEvent): Promise<void> => {
    if (!dropCollectionId) return
    e.preventDefault()
    e.stopPropagation()
    setOver(false)
    const ids = readInternalDrag(e.dataTransfer)
    const name = collections.find((c) => c.id === dropCollectionId)?.name ?? 'collection'
    if (ids.length > 0) {
      const ok = await addItems(dropCollectionId, ids)
      if (ok) {
        push({
          text: `Added ${count(ids.length, 'item')} to ${name}.`,
          action: {
            label: 'Undo',
            run: async () => {
              for (const id of ids) await invoke('collections:removeItem', { id: dropCollectionId, itemId: id })
              void useCollections.getState().load()
            }
          }
        })
      }
      return
    }
    const request = snapshotDrop(e.dataTransfer, getPathForFile, 'library', dropCollectionId)
    const result = await invoke('capture:drop', request)
    if (result.ok)
      push({
        text:
          result.data.items.length === 1 ? `Saved to ${name}.` : `Saved ${result.data.items.length} things to ${name}.`
      })
  }
  return (
    <button
      type="button"
      {...stylex.props(styles.row, current && styles.rowCurrent, over && styles.rowDrop)}
      aria-current={current ? 'true' : undefined}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onPointerEnter={(e) => {
        if (e.pointerType === 'touch') return
        setActive(true)
      }}
      onPointerLeave={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
      onDragOver={onDragOver}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => void onDrop(e)}
    >
      {icon !== undefined ? (
        <span {...stylex.props(styles.icon, current && styles.iconCurrent)}>
          {typeof icon === 'string' ? (
            <AnimatedSidebarIcon name={icon as AnimatedSidebarIconName} active={active} reducedMotion={reducedMotion} />
          ) : (
            icon
          )}
        </span>
      ) : null}
      <span {...stylex.props(styles.label, shared.ellipsis)}>{label}</span>
      {n !== undefined && n > 0 ? <span {...stylex.props(styles.count)}>{n}</span> : null}
    </button>
  )
}

/** Sections, collections, settings, local status. */
export function Sidebar(): React.JSX.Element {
  const section = useUi((s) => s.section)
  const setSection = useUi((s) => s.setSection)
  const currentCollectionId = useUi((s) => s.collectionId)
  const openSettings = useUi((s) => s.openSettings)
  const push = useUi((s) => s.push)
  const setView = useLibrary((s) => s.setView)
  const collections = useCollections((s) => s.list)
  const stats = useSettings((s) => s.stats)

  const go = (next: Section, collectionId: string | null = null): void => {
    setSection(next, collectionId)
    if (next !== 'collections') setView(next, collectionId)
  }

  const openCollectionMenu = async (e: React.MouseEvent, c: CollectionSummary): Promise<void> => {
    e.preventDefault()
    const result = await invoke('system:contextMenu', { kind: 'collection', ids: [], collectionId: c.id })
    if (!result.ok || !result.data.action) return
    if (result.data.action === 'rename') push({ kind: 'dialog', id: 'renameCollection', collectionId: c.id })
    if (result.data.action === 'delete') void useCollections.getState().remove(c.id)
  }

  return (
    <nav {...stylex.props(styles.sidebar)} aria-label="Library">
      <div {...stylex.props(styles.drag, shared.drag)}>
        <span {...stylex.props(styles.brand)}>KeepAnything</span>
      </div>
      <div {...stylex.props(styles.nav)}>
        <Row
          icon="library"
          label="Library"
          count={stats?.items}
          current={section === 'library'}
          onClick={() => go('library')}
        />
        <Row icon="links" label="Links" current={section === 'links'} onClick={() => go('links')} />
        <Row icon="file" label="Files" current={section === 'files'} onClick={() => go('files')} />
        <Row
          icon="collections"
          label="Collections"
          count={collections.length}
          current={section === 'collections'}
          onClick={() => go('collections')}
        />
        <Row icon="trash" label="Trash" current={section === 'trash'} onClick={() => go('trash')} />

        <div {...stylex.props(styles.group)}>
          <div {...stylex.props(styles.groupHead)}>
            <span>Collections</span>
            <button
              type="button"
              {...stylex.props(styles.groupAdd)}
              aria-label="New collection"
              onClick={() => push({ kind: 'dialog', id: 'newCollection' })}
            >
              <Plus size={14} strokeWidth={1.5} />
            </button>
          </div>
          {collections.length === 0 ? (
            <p {...stylex.props(styles.empty)}>None yet. They appear as the library grows.</p>
          ) : null}
          {collections.map((c) => (
            <Row
              key={c.id}
              icon={
                <span
                  {...stylex.props(
                    styles.swatch,
                    c.type !== 'manual' && styles.swatchAi,
                    c.color ? styles.swatchColor(c.color) : null
                  )}
                />
              }
              label={c.name}
              count={c.count}
              current={section === 'collection' && currentCollectionId === c.id}
              onClick={() => go('collection', c.id)}
              onContextMenu={(e) => void openCollectionMenu(e, c)}
              dropCollectionId={c.id}
            />
          ))}
        </div>
      </div>
      <div {...stylex.props(styles.bottom)}>
        <Row icon={<Settings size={16} strokeWidth={1.5} />} label="Settings" current={false} onClick={openSettings} />
        <LocalStatusFooter />
      </div>
    </nav>
  )
}
