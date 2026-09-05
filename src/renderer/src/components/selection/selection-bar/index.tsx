import * as stylex from '@stylexjs/stylex'
import { Check, Layers, Plus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { commandsFor } from '../../../lib/commands'
import { count } from '../../../lib/format'
import { describeError } from '../../../lib/ipc-client'
import { addToCollection, startSelectionCommand } from '../../../lib/library-actions'
import { useCollections } from '../../../state/collections'
import { useLibrary } from '../../../state/library'
import { useSettings } from '../../../state/settings'
import { useToasts } from '../../../state/toasts'
import { shared } from '../../../styles/shared'
import { Button } from '../../common'
import { styles } from './styles'

function AddToCollectionPopover({ ids, onDone }: { ids: string[]; onDone: () => void }): React.JSX.Element {
  const collections = useCollections((s) => s.list)
  const create = useCollections((s) => s.create)
  const push = useToasts((s) => s.push)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onDone()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onDone()
      }
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [onDone])

  const add = async (collectionId: string): Promise<void> => {
    setBusy(true)
    await addToCollection(collectionId, ids)
    setBusy(false)
    onDone()
  }

  const createNew = async (): Promise<void> => {
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    const r = await create(trimmed)
    if (!r.ok) {
      setBusy(false)
      push({ text: describeError(r.error) })
      return
    }
    await add(r.data.id)
  }

  const inAll = (id: string): boolean => {
    const byId = useLibrary.getState().byId
    return ids.every((itemId) => byId[itemId]?.collectionIds.includes(id))
  }

  return (
    <div ref={ref} {...stylex.props(styles.popover)} role="dialog" aria-label="Add to collection">
      <div {...stylex.props(styles.popList)}>
        <span {...stylex.props(shared.eyebrow, styles.popHead)}>Add {count(ids.length, 'item')} to</span>
        {collections.length === 0 ? (
          <p {...stylex.props(styles.popEmpty)}>No collections yet. Name one below.</p>
        ) : null}
        {collections.map((c) => {
          const already = inAll(c.id)
          return (
            <button
              key={c.id}
              type="button"
              {...stylex.props(styles.popItem)}
              disabled={busy || already}
              onClick={() => void add(c.id)}
            >
              <span {...stylex.props(styles.popIcon)}>
                {already ? <Check size={14} strokeWidth={1.5} /> : <Layers size={14} strokeWidth={1.5} />}
              </span>
              <span {...stylex.props(shared.ellipsis)}>{c.name}</span>
              <span {...stylex.props(styles.popMeta)}>{already ? 'Added' : c.count}</span>
            </button>
          )
        })}
      </div>
      <form
        {...stylex.props(styles.popNew)}
        onSubmit={(e) => {
          e.preventDefault()
          void createNew()
        }}
      >
        <input
          ref={inputRef}
          {...stylex.props(styles.popInput)}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New collection…"
          aria-label="New collection name"
        />
        <Button small icon type="submit" aria-label="Create and add" disabled={busy || !name.trim()}>
          <Plus size={14} strokeWidth={1.5} />
        </Button>
      </form>
    </div>
  )
}

/** Shows for ≥ 2 selected items. Multi-item commands go to the agent via the palette. */
export function SelectionBar(): React.JSX.Element | null {
  const selection = useLibrary((s) => s.selection)
  const clear = useLibrary((s) => s.clearSelection)
  const trash = useLibrary((s) => s.trash)
  const restore = useLibrary((s) => s.restore)
  const deleteForever = useLibrary((s) => s.deleteForever)
  const inTrash = useLibrary((s) => s.query.view === 'trash')
  const aiStatus = useSettings((s) => s.stats?.aiStatus)
  const push = useToasts((s) => s.push)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    if (selection.size < 2) setAdding(false)
  }, [selection.size])

  if (selection.size < 2) return null
  const ids = [...selection]
  const aiOff = aiStatus === 'off' || aiStatus === 'unconfigured'

  return (
    <div {...stylex.props(styles.wrap)}>
      {adding ? <AddToCollectionPopover ids={ids} onDone={() => setAdding(false)} /> : null}
      <div {...stylex.props(styles.bar)} role="toolbar" aria-label="Selection">
        <span {...stylex.props(styles.count)}>{count(ids.length, 'item')} selected</span>
        {!inTrash ? (
          <>
            {commandsFor(ids.length).map((c) => (
              <Button
                key={c.template}
                small
                variant="quiet"
                title={aiOff ? 'Connect GMI in Settings to do this.' : c.question}
                disabled={aiOff}
                onClick={() => void startSelectionCommand(c.template, ids)}
              >
                {c.label}
              </Button>
            ))}
            <span {...stylex.props(styles.sep)} aria-hidden="true" />
            <Button small variant="quiet" aria-expanded={adding} onClick={() => setAdding((v) => !v)}>
              <Layers size={14} strokeWidth={1.5} />
              Add to collection
            </Button>
          </>
        ) : null}
        <span {...stylex.props(styles.sep)} aria-hidden="true" />
        {inTrash ? (
          <>
            <Button
              small
              variant="quiet"
              onClick={async () => {
                const ok = await restore(ids)
                if (ok) push({ text: `Restored ${count(ids.length, 'item')}.` })
              }}
            >
              Restore
            </Button>
            <Button small variant="danger" onClick={() => void deleteForever(ids)}>
              Delete forever
            </Button>
          </>
        ) : (
          <Button
            small
            variant="danger"
            onClick={async () => {
              const ok = await trash(ids)
              if (ok)
                push({
                  text: `Moved ${count(ids.length, 'item')} to Trash.`,
                  action: { label: 'Undo', run: () => restore(ids) }
                })
            }}
          >
            Trash
          </Button>
        )}
        <Button small icon variant="quiet" onClick={clear} aria-label="Clear selection" title="Clear selection (Esc)">
          <X size={14} strokeWidth={1.5} />
        </Button>
      </div>
    </div>
  )
}
