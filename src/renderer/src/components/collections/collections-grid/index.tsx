import * as stylex from '@stylexjs/stylex'
import { Layers, Plus } from 'lucide-react'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import type { CollectionSummary } from '../../../../../shared/types'
import { count } from '../../../lib/format'
import { describeError, invoke } from '../../../lib/ipc-client'
import { useCollections } from '../../../state/collections'
import { useLibrary } from '../../../state/library'
import { useToasts } from '../../../state/toasts'
import { useUi } from '../../../state/ui'
import { shared } from '../../../styles/shared'
import { Button, MenuTrigger, Thumb } from '../../common'
import { styles } from './styles'

function CollectionCard({ c, onOpen }: { c: CollectionSummary; onOpen: () => void }): React.JSX.Element {
  const pushModal = useUi((s) => s.push)
  const covers = c.coverThumbnailUrls.slice(0, 4)

  const openMenu = async (e: React.MouseEvent): Promise<void> => {
    e.preventDefault()
    const result = await invoke('system:contextMenu', { kind: 'collection', ids: [], collectionId: c.id })
    if (!result.ok || !result.data.action) return
    if (result.data.action === 'rename-collection')
      pushModal({ kind: 'dialog', id: 'renameCollection', collectionId: c.id })
    if (result.data.action === 'delete-collection')
      pushModal({ kind: 'dialog', id: 'deleteCollection', collectionId: c.id })
  }

  return (
    <article
      {...stylex.props(styles.card, stylex.defaultMarker())}
      onContextMenu={(e) => void openMenu(e)}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen()
      }}
      tabIndex={0}
      aria-label={c.name}
    >
      <span
        {...stylex.props(
          styles.cover,
          covers.length <= 1 && styles.coverSingle,
          covers.length === 0 && styles.coverEmpty
        )}
      >
        {covers.length === 0 ? <Layers size={22} strokeWidth={1.25} /> : null}
        {covers.map((src, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static list, never reordered
          <span key={`${c.id}-${i}`} {...stylex.props(styles.cell)}>
            <Thumb src={src} />
          </span>
        ))}
        <span {...stylex.props(styles.menu)}>
          <MenuTrigger onOpen={(e) => void openMenu(e)} />
        </span>
      </span>
      <span {...stylex.props(styles.caption)}>
        <span {...stylex.props(styles.name, shared.ellipsis)}>{c.name}</span>
        <span {...stylex.props(styles.meta)}>
          <span>{count(c.count, 'item')}</span>
        </span>
        {c.description ? <span {...stylex.props(styles.description)}>{c.description}</span> : null}
      </span>
    </article>
  )
}

/** Cover collages with counts and type; click opens the collection view. */
export function CollectionsGrid(): React.JSX.Element {
  const list = useCollections((s) => s.list)
  const setSection = useUi((s) => s.setSection)
  const pushModal = useUi((s) => s.push)
  const setView = useLibrary((s) => s.setView)
  const open = (c: CollectionSummary): void => {
    setSection('collection', c.id)
    setView('collection', c.id)
  }
  return (
    <div {...stylex.props(styles.grid)}>
      {list.map((c) => (
        <CollectionCard key={c.id} c={c} onOpen={() => open(c)} />
      ))}
      <div {...stylex.props(styles.newWrap)}>
        <button
          type="button"
          {...stylex.props(styles.newCard)}
          onClick={() => pushModal({ kind: 'dialog', id: 'newCollection' })}
        >
          <Plus size={16} strokeWidth={1.5} />
          New collection
          <span {...stylex.props(styles.newSub)}>Drag things in, or let the agent fill it</span>
        </button>
      </div>
    </div>
  )
}

/** New / rename / delete dialogs (one small sheet). */
export function CollectionDialog({
  mode,
  collectionId
}: {
  mode: 'new' | 'rename' | 'delete'
  collectionId?: string
}): React.JSX.Element {
  const existing = useCollections((s) => (collectionId ? s.list.find((c) => c.id === collectionId) : undefined))
  const create = useCollections((s) => s.create)
  const rename = useCollections((s) => s.rename)
  const remove = useCollections((s) => s.remove)
  const pop = useUi((s) => s.pop)
  const setSection = useUi((s) => s.setSection)
  const section = useUi((s) => s.section)
  const currentCollectionId = useUi((s) => s.collectionId)
  const setView = useLibrary((s) => s.setView)
  const push = useToasts((s) => s.push)
  const [name, setName] = useState(existing?.name ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const trimmed = name.trim()
    setBusy(true)
    if (mode === 'delete' && collectionId) {
      const ok = await remove(collectionId)
      if (ok) {
        if (section === 'collection' && currentCollectionId === collectionId) {
          setSection('collections')
        }
        push({ text: `Deleted ${existing?.name ?? 'the collection'}.`, detail: 'Its items are still in your library.' })
      }
    } else if (!trimmed) {
      setBusy(false)
      return
    } else if (mode === 'new') {
      const r = await create(trimmed, description.trim() || undefined)
      if (!r.ok) push({ text: describeError(r.error) })
      else {
        setSection('collection', r.data.id)
        setView('collection', r.data.id)
      }
    } else if (mode === 'rename' && collectionId) {
      await rename(collectionId, trimmed, description.trim())
    }
    setBusy(false)
    pop()
  }

  const title = mode === 'new' ? 'New collection' : mode === 'rename' ? 'Rename collection' : 'Delete collection?'

  return (
    <div
      {...stylex.props(styles.dialog)}
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && pop()}
    >
      <form
        {...stylex.props(styles.sheet)}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onSubmit={(e) => void submit(e)}
      >
        <h2 {...stylex.props(styles.sheetTitle)}>{title}</h2>
        {mode === 'delete' ? (
          <p {...stylex.props(styles.danger)}>
            “{existing?.name}” goes away. The {count(existing?.count ?? 0, 'item')} in it stay in your library.
          </p>
        ) : (
          <>
            <label {...stylex.props(styles.field)}>
              <span {...stylex.props(styles.label)}>Name</span>
              <input
                ref={ref}
                {...stylex.props(styles.input)}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Something you keep coming back to"
              />
            </label>
            <label {...stylex.props(styles.field)}>
              <span {...stylex.props(styles.label)}>Description (optional)</span>
              <textarea
                {...stylex.props(styles.input, styles.textarea)}
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What belongs here, and what does not"
              />
              <span {...stylex.props(styles.fieldHint)}>
                The AI reads this description, and what is already inside, to decide where new items go.
              </span>
            </label>
          </>
        )}
        <div {...stylex.props(styles.row)}>
          <Button variant="quiet" onClick={() => pop()}>
            Cancel
          </Button>
          {mode === 'delete' ? (
            <Button variant="danger" type="submit" disabled={busy}>
              Delete
            </Button>
          ) : (
            <Button variant="primary" type="submit" disabled={busy || !name.trim()}>
              {mode === 'new' ? 'Create' : 'Rename'}
            </Button>
          )}
        </div>
      </form>
    </div>
  )
}
