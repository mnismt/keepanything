import * as stylex from '@stylexjs/stylex'
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Eye,
  FileText,
  Folder,
  FolderOpen,
  RefreshCw,
  StickyNote,
  Trash2,
  X
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { COPY } from '../../../../../shared/constants'
import { isTerminal, STATUS_LABEL } from '../../../../../shared/status'
import type {
  ItemDetailCollection,
  ItemDetail as ItemDetailModel,
  ItemDetailRelationship,
  ItemSummary
} from '../../../../../shared/types'
import { runTitle } from '../../../lib/activity'
import { ago, count, formatBytes, formatDuration, typeLabel } from '../../../lib/format'
import { describeError, invoke } from '../../../lib/ipc-client'
import { useCollections } from '../../../state/collections'
import { useLibrary } from '../../../state/library'
import { useRuns } from '../../../state/runs'
import { useSettings } from '../../../state/settings'
import { useToasts } from '../../../state/toasts'
import { useUi } from '../../../state/ui'
import { shared } from '../../../styles/shared'
import { Button, Dot, InlineEdit, Thumb, toneForStatus } from '../../common'
import { AgentActivity } from '../agent-activity'
import { styles } from './styles'

/** Tiny markdown renderer for note heroes: headings, bullet lists, paragraphs. No inline syntax. */
function MarkdownLite({ source }: { source: string }): React.JSX.Element {
  const blocks = source.replace(/\r\n/g, '\n').split(/\n{2,}/)
  return (
    <>
      {blocks.map((block, i) => {
        const trimmed = block.trim()
        if (!trimmed) return null
        const key = `${i}-${trimmed.slice(0, 12)}`
        if (trimmed.startsWith('# '))
          return (
            <h3 key={key} {...stylex.props(styles.mdH)}>
              {trimmed.slice(2)}
            </h3>
          )
        if (/^#{2,6} /.test(trimmed))
          return (
            <h4 key={key} {...stylex.props(styles.mdH2)}>
              {trimmed.replace(/^#{2,6} /, '')}
            </h4>
          )
        const lines = trimmed.split('\n')
        if (lines.every((l) => /^[-*] /.test(l))) {
          return (
            <ul key={key} {...stylex.props(styles.mdList)}>
              {lines.map((l, j) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static list, never reordered
                <li key={`${key}-${j}`} {...stylex.props(styles.mdLi)}>
                  {l.replace(/^[-*] /, '').replace(/\[(\d+)\]/g, ' [$1]')}
                </li>
              ))}
            </ul>
          )
        }
        return (
          <p key={key} {...stylex.props(styles.mdP)}>
            {trimmed.replace(/\n/g, ' ')}
          </p>
        )
      })}
    </>
  )
}

function Hero({
  detail,
  item,
  content,
  onOpenItem
}: {
  detail: ItemDetailModel | null
  item: ItemSummary | undefined
  content: string | null
  onOpenItem: (id: string) => void
}): React.JSX.Element {
  if (!item) return <div />
  const textual = item.type === 'text' || item.type === 'markdown' || item.type === 'note'
  if (textual) {
    const source = content ?? detail?.item.extractedText ?? item.excerpt ?? ''
    const isMarkdown = item.type !== 'text'
    return (
      <div {...stylex.props(styles.heroText, !isMarkdown && styles.heroPlain, shared.selectable)}>
        {isMarkdown ? <MarkdownLite source={source} /> : source}
      </div>
    )
  }
  if (item.type === 'folder' && detail?.children && detail.children.length > 0) {
    return (
      <div {...stylex.props(styles.children)}>
        {detail.children.slice(0, 24).map((c) => (
          <button key={c.id} type="button" {...stylex.props(styles.child)} onClick={() => onOpenItem(c.id)}>
            <span {...stylex.props(styles.childThumb)}>
              <Thumb src={c.thumbnailUrl} fill={c.dominantColor} />
            </span>
            <span {...stylex.props(styles.childTitle, shared.ellipsis)}>{c.title}</span>
          </button>
        ))}
      </div>
    )
  }
  const src =
    detail?.originalUrl && item.type === 'image' ? detail.originalUrl : (item.snapshotUrl ?? item.thumbnailUrl)
  if (src && !item.isMissing) {
    return (
      <img
        {...stylex.props(styles.heroImg, item.type === 'pdf' && styles.heroPaper)}
        src={src}
        alt=""
        draggable={false}
      />
    )
  }
  if (item.type === 'url' && item.subtype === 'github_repo') {
    return (
      <div {...stylex.props(styles.heroRepo, shared.selectable)}>
        <span {...stylex.props(shared.eyebrow)}>{item.card?.owner ?? 'GitHub'}</span>
        <span {...stylex.props(styles.heroRepoName)}>{item.title}</span>
        {item.card?.description ? <p {...stylex.props(styles.heroRepoDesc)}>{item.card.description}</p> : null}
        <span {...stylex.props(styles.heroRepoMeta)}>
          {item.card?.language ? <span>{item.card.language}</span> : null}
          {item.card?.stars !== null && item.card?.stars !== undefined ? (
            <span>{item.card.stars.toLocaleString()} stars</span>
          ) : null}
          {item.domain ? <span>{item.domain}</span> : null}
        </span>
      </div>
    )
  }
  const ext = /\.([a-z0-9]{1,6})$/i.exec(item.title)?.[1]?.toUpperCase()
  return (
    <div {...stylex.props(styles.heroTile)}>
      <span {...stylex.props(styles.heroGlyph)}>
        {item.type === 'folder' ? <Folder size={36} strokeWidth={1} /> : <FileText size={36} strokeWidth={1} />}
      </span>
      <span {...stylex.props(styles.heroTileExt)}>
        {item.isMissing ? 'Original moved or deleted' : (ext ?? typeLabel(item))}
      </span>
    </div>
  )
}

function RelatedRow({
  rel,
  onOpen,
  onRemove
}: {
  rel: ItemDetailRelationship
  onOpen: () => void
  onRemove: () => void
}): React.JSX.Element {
  return (
    <div {...stylex.props(styles.row, stylex.defaultMarker())}>
      <span {...stylex.props(styles.rowThumb)}>
        <Thumb src={rel.other.thumbnailUrl} fill={rel.other.dominantColor} />
      </span>
      <button type="button" {...stylex.props(styles.rowMain)} onClick={onOpen}>
        <span {...stylex.props(styles.rowTitle, shared.ellipsis)}>{rel.other.title}</span>
        <span {...stylex.props(styles.rowSub)}>
          <span {...stylex.props(styles.rowLabel)}>{rel.label}</span>
          {rel.description ? ` · ${rel.description}` : ''}
          {rel.evidence?.quote ? <span {...stylex.props(styles.quote)}> “{rel.evidence.quote}”</span> : null}
        </span>
      </button>
      <button
        type="button"
        {...stylex.props(styles.rowRemove)}
        aria-label={`Remove relationship with ${rel.other.title}`}
        title="Remove relationship"
        onClick={onRemove}
      >
        <X size={14} strokeWidth={1.5} />
      </button>
    </div>
  )
}

function CollectionRow({
  c,
  onOpen,
  onRemove
}: {
  c: ItemDetailCollection
  onOpen: () => void
  onRemove: () => void
}): React.JSX.Element {
  const summary = useCollections((s) => s.list.find((x) => x.id === c.id))
  const covers = summary?.coverThumbnailUrls.slice(0, 4) ?? []
  const who = c.addedBy === 'agent' ? 'Organized for you' : 'Added by you'
  return (
    <div {...stylex.props(styles.row, stylex.defaultMarker())}>
      <span {...stylex.props(styles.rowCover)}>
        {covers.map((src, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static list, never reordered
          <Thumb key={`${c.id}-${i}`} src={src} />
        ))}
      </span>
      <button type="button" {...stylex.props(styles.rowMain)} onClick={onOpen}>
        <span {...stylex.props(styles.rowTitle, shared.ellipsis)}>{c.name}</span>
        <span {...stylex.props(styles.rowSub)}>
          {c.reason ? (
            <>
              <span {...stylex.props(styles.rowLabel)}>Because:</span> {c.reason}
            </>
          ) : (
            who
          )}
        </span>
      </button>
      <button
        type="button"
        {...stylex.props(styles.rowRemove)}
        aria-label={`Remove from ${c.name}`}
        title="Remove from collection"
        onClick={onRemove}
      >
        <X size={14} strokeWidth={1.5} />
      </button>
    </div>
  )
}

/**
 * In-pane view over the content area (sidebar stays). Hero on the left, editable
 * facts on the right; a single scrolling column on narrow windows. Esc closes (shell keys),
 * ←/→ walk the current view.
 */
export function ItemDetail({ itemId }: { itemId: string }): React.JSX.Element {
  const [detail, setDetail] = useState<ItemDetailModel | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const closeDetail = useUi((s) => s.closeDetail)
  const openDetail = useUi((s) => s.openDetail)
  const setSection = useUi((s) => s.setSection)
  const setView = useLibrary((s) => s.setView)
  const section = useUi((s) => s.section)
  const currentCollectionId = useUi((s) => s.collectionId)
  const collectionName = useCollections((s) => s.list.find((c) => c.id === currentCollectionId)?.name)
  const order = useLibrary((s) => s.order)
  const summary = useLibrary((s) => s.byId[itemId])
  const aiStatus = useSettings((s) => s.stats?.aiStatus)
  const push = useToasts((s) => s.push)
  const trash = useLibrary((s) => s.trash)
  const restore = useLibrary((s) => s.restore)
  const collections = useCollections((s) => s.list)
  const liveRunCount = useRuns(
    (s) => s.order.filter((id) => s.runs[id]?.itemId === itemId && s.runs[id]?.status !== 'running').length
  )

  const reload = useCallback(async () => {
    const r = await invoke('items:get', { id: itemId })
    if (r.ok) {
      setDetail(r.data)
      setError(null)
    } else setError(describeError(r.error))
  }, [itemId])

  useEffect(() => {
    setDetail(null)
    setContent(null)
    void reload()
  }, [reload])
  // Refresh when the card's facts change (pipeline progress, agent edits, finished runs).
  const facts = `${summary?.processingStatus}|${summary?.understanding}|${summary?.collectionIds.length}|${liveRunCount}`
  const factsRef = useRef(facts)
  useEffect(() => {
    if (factsRef.current === facts) return
    factsRef.current = facts
    void reload()
  }, [facts, reload])

  useEffect(() => {
    const type = detail?.item.type
    if (!type || (type !== 'note' && type !== 'markdown' && type !== 'text')) return
    let cancelled = false
    void invoke('items:readContent', { id: itemId }).then((r) => {
      if (!cancelled && r.ok) setContent(r.data.markdown ?? r.data.text ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [itemId, detail?.item.type])

  const index = order.indexOf(itemId)
  const prev = index > 0 ? order[index - 1] : undefined
  const next = index >= 0 && index < order.length - 1 ? order[index + 1] : undefined

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return
      if (e.key === 'ArrowLeft' && prev) openDetail(prev, prev)
      if (e.key === 'ArrowRight' && next) openDetail(next, next)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [prev, next, openDetail])

  const item = detail?.summary ?? summary
  const row = detail?.item
  const working = item ? !isTerminal(item.processingStatus) : false
  const overrides = row?.userOverrides ?? {}

  const save = async (patch: { title?: string; understanding?: string; whyUseful?: string }): Promise<void> => {
    const r = await invoke('items:update', { id: itemId, patch })
    if (r.ok) setDetail(r.data)
    else push({ text: describeError(r.error) })
  }

  const openItem = (id: string): void => openDetail(id, itemId)
  const openCollection = (id: string): void => {
    closeDetail()
    setSection('collection', id)
    setView('collection', id)
  }

  const removeRelationship = async (rel: ItemDetailRelationship): Promise<void> => {
    const r = await invoke('relationships:remove', { id: rel.id })
    if (!r.ok) {
      push({ text: describeError(r.error) })
      return
    }
    void reload()
    push({
      text: `Removed “${rel.label}” link to ${rel.other.title}.`,
      detail: 'It will not be suggested again.',
      action: {
        label: 'Undo',
        run: async () => {
          await invoke('relationships:create', {
            sourceId: rel.sourceItemId,
            targetId: rel.targetItemId,
            type: rel.type,
            ...(rel.description ? { description: rel.description } : {})
          })
          void reload()
        }
      }
    })
  }

  const removeFromCollection = async (c: ItemDetailCollection): Promise<void> => {
    const ok = await useCollections.getState().removeItem(c.id, itemId)
    if (!ok) {
      push({ text: "Couldn't remove that right now." })
      return
    }
    void reload()
    push({
      text: `Removed from ${c.name}.`,
      detail: 'It will not be added back automatically.',
      action: {
        label: 'Undo',
        run: async () => {
          await useCollections.getState().addItems(c.id, [itemId])
          void reload()
        }
      }
    })
  }

  const moveToTrash = async (): Promise<void> => {
    const ok = await trash([itemId])
    if (!ok) return
    closeDetail()
    push({ text: 'Moved to Trash.', action: { label: 'Undo', run: () => restore([itemId]) } })
  }

  const hasFile = Boolean(row?.originalPath || row?.managedPath) && !item?.isMissing
  const isUrl = item?.type === 'url'
  const isNote = item?.type === 'note'
  const aiOff = aiStatus === 'unconfigured' || aiStatus === 'off'
  const openSettings = useUi((s) => s.openSettings)
  const crumb =
    section === 'collection'
      ? (collectionName ?? 'Collection')
      : section === 'collections'
        ? 'Collections'
        : section.charAt(0).toUpperCase() + section.slice(1)

  return (
    <section {...stylex.props(styles.detail)} aria-label={item?.title ?? 'Item'} data-detail>
      <div {...stylex.props(styles.hero)}>
        <Hero detail={detail} item={item} content={content} onOpenItem={openItem} />
      </div>
      <aside {...stylex.props(styles.side, shared.selectable)}>
        <div {...stylex.props(styles.top)}>
          <Button icon small variant="quiet" aria-label="Close" onClick={closeDetail}>
            <X size={14} strokeWidth={1.5} />
          </Button>
          <span {...stylex.props(styles.crumb, shared.ellipsis)}>{crumb}</span>
          <Button
            icon
            small
            variant="quiet"
            aria-label="Previous"
            disabled={!prev}
            onClick={() => prev && openDetail(prev, prev)}
          >
            <ChevronLeft size={14} strokeWidth={1.5} />
          </Button>
          <Button
            icon
            small
            variant="quiet"
            aria-label="Next"
            disabled={!next}
            onClick={() => next && openDetail(next, next)}
          >
            <ChevronRight size={14} strokeWidth={1.5} />
          </Button>
        </div>

        {error ? <p {...stylex.props(styles.body)}>{error}</p> : null}

        <div>
          <InlineEdit
            value={item?.title ?? ''}
            label="title"
            placeholder="Untitled"
            style={styles.title}
            onSave={(title) => (title ? save({ title }) : undefined)}
            disabled={!item}
          />
          {item ? (
            <div {...stylex.props(styles.meta)}>
              <span>{typeLabel(item)}</span>
              {item.domain ? (
                <>
                  <span {...stylex.props(styles.metaSep)} aria-hidden="true" />
                  <button
                    type="button"
                    {...stylex.props(styles.link)}
                    onClick={() => void invoke('items:openUrl', { id: itemId })}
                    title={item.url ?? undefined}
                  >
                    {item.domain}
                  </button>
                </>
              ) : null}
              {item.size ? (
                <>
                  <span {...stylex.props(styles.metaSep)} aria-hidden="true" />
                  <span>{formatBytes(item.size)}</span>
                </>
              ) : null}
              {item.pageCount ? (
                <>
                  <span {...stylex.props(styles.metaSep)} aria-hidden="true" />
                  <span>{count(item.pageCount, 'page')}</span>
                </>
              ) : null}
              {item.durationMs ? (
                <>
                  <span {...stylex.props(styles.metaSep)} aria-hidden="true" />
                  <span>{formatDuration(item.durationMs)}</span>
                </>
              ) : null}
              {item.width && item.height && (item.type === 'image' || item.type === 'video') ? (
                <>
                  <span {...stylex.props(styles.metaSep)} aria-hidden="true" />
                  <span>
                    {item.width}×{item.height}
                  </span>
                </>
              ) : null}
              <span {...stylex.props(styles.metaSep)} aria-hidden="true" />
              <span title={item.capturedAt}>Kept {ago(item.capturedAt)}</span>
            </div>
          ) : null}
          {item && item.processingStatus !== 'READY' ? (
            <div {...stylex.props(styles.status)}>
              <Dot tone={toneForStatus(item.processingStatus)} />
              <span>{STATUS_LABEL[item.processingStatus] || 'Kept.'}</span>
              {item.processingError ? <span {...stylex.props(styles.muted)}>· {item.processingError}</span> : null}
            </div>
          ) : null}
        </div>

        <div {...stylex.props(styles.section)}>
          <div {...stylex.props(styles.sectionHead)}>
            <span {...stylex.props(shared.eyebrow)}>Understanding</span>
            {overrides.understanding ? <span {...stylex.props(styles.edited)}>Edited by you</span> : null}
          </div>
          {row?.understanding || item?.understanding ? (
            <InlineEdit
              multiline
              value={row?.understanding ?? item?.understanding ?? ''}
              label="understanding"
              style={styles.body}
              onSave={(understanding) => save({ understanding })}
            />
          ) : (
            <p {...stylex.props(styles.hint)}>
              {aiOff ? (
                <>
                  {COPY.connectHint.replace(' in Settings', '')}{' '}
                  <button type="button" {...stylex.props(styles.hintLink)} onClick={openSettings}>
                    Open Settings
                  </button>
                </>
              ) : working ? (
                'Still working on this.'
              ) : (
                COPY.stillFiguring
              )}
            </p>
          )}
          {row?.whyUseful || overrides.whyUseful ? (
            <>
              <div {...stylex.props(styles.sectionHead)}>
                <span {...stylex.props(shared.eyebrow)}>Why useful</span>
                {overrides.whyUseful ? <span {...stylex.props(styles.edited)}>Edited by you</span> : null}
              </div>
              <InlineEdit
                multiline
                value={row?.whyUseful ?? ''}
                label="why useful"
                style={styles.body}
                placeholder="Why keep this?"
                onSave={(whyUseful) => save({ whyUseful })}
              />
            </>
          ) : null}
          {row && (row.topics.length > 0 || row.entities.length > 0) ? (
            <div {...stylex.props(styles.tags)}>
              {row.entities.map((e) => (
                <span key={`e-${e}`} {...stylex.props(styles.entity)}>
                  {e}
                </span>
              ))}
              {row.topics.map((t) => (
                <span key={`t-${t}`}>{t}</span>
              ))}
            </div>
          ) : null}
        </div>

        {detail && detail.relationships.length > 0 ? (
          <div {...stylex.props(styles.section)}>
            <span {...stylex.props(shared.eyebrow)}>Related</span>
            <div {...stylex.props(styles.rows)}>
              {detail.relationships.map((r) => (
                <RelatedRow
                  key={r.id}
                  rel={r}
                  onOpen={() => openItem(r.other.id)}
                  onRemove={() => void removeRelationship(r)}
                />
              ))}
            </div>
          </div>
        ) : null}

        {detail && detail.collections.length > 0 ? (
          <div {...stylex.props(styles.section)}>
            <span {...stylex.props(shared.eyebrow)}>Collections</span>
            <div {...stylex.props(styles.rows)}>
              {detail.collections.map((c) => (
                <CollectionRow
                  key={c.id}
                  c={c}
                  onOpen={() => openCollection(c.id)}
                  onRemove={() => void removeFromCollection(c)}
                />
              ))}
            </div>
          </div>
        ) : null}

        <div {...stylex.props(styles.section)}>
          <span {...stylex.props(shared.eyebrow)}>Actions</span>
          <div {...stylex.props(styles.actions)}>
            {isUrl ? (
              <button
                type="button"
                {...stylex.props(styles.action)}
                onClick={() => void invoke('items:openUrl', { id: itemId })}
              >
                <span {...stylex.props(styles.actionLabel)}>
                  <ExternalLink size={14} strokeWidth={1.75} aria-hidden />
                  Open link
                </span>
              </button>
            ) : (
              <button
                type="button"
                {...stylex.props(styles.action)}
                disabled={!hasFile}
                onClick={() => void invoke('items:openOriginal', { id: itemId })}
              >
                <span {...stylex.props(styles.actionLabel)}>
                  {isNote ? (
                    <StickyNote size={14} strokeWidth={1.75} aria-hidden />
                  ) : (
                    <ExternalLink size={14} strokeWidth={1.75} aria-hidden />
                  )}
                  {isNote ? 'Open note' : 'Open original'}
                </span>
              </button>
            )}
            {!isUrl ? (
              <>
                <button
                  type="button"
                  {...stylex.props(styles.action)}
                  disabled={!hasFile}
                  onClick={() => void invoke('items:revealInFinder', { id: itemId })}
                >
                  <span {...stylex.props(styles.actionLabel)}>
                    <FolderOpen size={14} strokeWidth={1.75} aria-hidden />
                    Reveal in Finder
                  </span>
                </button>
                <button
                  type="button"
                  {...stylex.props(styles.action)}
                  disabled={!hasFile}
                  onClick={() => void invoke('items:quickLook', { id: itemId })}
                >
                  <span {...stylex.props(styles.actionLabel)}>
                    <Eye size={14} strokeWidth={1.75} aria-hidden />
                    Quick Look
                  </span>
                  <span {...stylex.props(styles.actionMeta)}>Space</span>
                </button>
              </>
            ) : null}
            <span {...stylex.props(styles.actionsDivider)} aria-hidden="true" />
            <button
              type="button"
              {...stylex.props(styles.action)}
              onClick={async () => {
                const ok = await useLibrary.getState().reprocess(itemId)
                push({ text: ok ? 'Reading this again.' : "Couldn't start that." })
              }}
            >
              <span {...stylex.props(styles.actionLabel)}>
                <RefreshCw size={14} strokeWidth={1.75} aria-hidden />
                Reprocess
              </span>
            </button>
            <button
              type="button"
              {...stylex.props(styles.action, styles.actionDanger)}
              onClick={() => void moveToTrash()}
            >
              <span {...stylex.props(styles.actionLabel)}>
                <Trash2 size={14} strokeWidth={1.75} aria-hidden />
                Move to Trash
              </span>
              <span {...stylex.props(styles.actionMeta)}>⌫</span>
            </button>
          </div>
        </div>

        <div {...stylex.props(styles.section)}>
          <span {...stylex.props(shared.eyebrow)}>Activity</span>
          <AgentActivity itemId={itemId} latestRuns={detail?.latestRuns ?? []} onOpenItem={openItem} />
        </div>

        <div {...stylex.props(styles.footer)}>
          {item ? (
            <span>
              Kept {new Date(item.capturedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
            </span>
          ) : null}
          {row?.originalPath ? <span {...stylex.props(styles.path)}>{row.originalPath}</span> : null}
          {row?.url && row.url !== item?.domain ? <span {...stylex.props(styles.path)}>{row.url}</span> : null}
          {collections.length === 0 && !working && item && !isNote ? (
            <span>{runTitle({ task: 'organize', status: 'running' })} happens as the library grows.</span>
          ) : null}
        </div>
      </aside>
    </section>
  )
}
