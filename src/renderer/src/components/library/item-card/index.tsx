import * as stylex from '@stylexjs/stylex'
import { ArrowUpRight, Check, Eye, FileText, Folder, Music, Play, Star, X } from 'lucide-react'
import { type DragEvent, type KeyboardEvent, type MouseEvent, memo, type ReactNode } from 'react'
import { isFailed, isTerminal, STATUS_LABEL } from '../../../../../shared/status'
import type { ItemSummary } from '../../../../../shared/types'
import { formatBytes, formatDuration, secondaryLine, typeLabel } from '../../../lib/format'
import { shared } from '../../../styles/shared'
import { Dot, MenuTrigger, Thumb, toneForStatus } from '../../common'
import { styles } from './styles'

export interface ItemCardProps {
  item: ItemSummary
  /** Layout rect from the masonry algorithm. */
  x: number
  y: number
  w: number
  h: number
  /** Height of the caption block reserved by the layout. */
  captionHeight: number
  selected: boolean
  focused: boolean
  /** ≥ 2 selected: show the check badge. */
  multi: boolean
  onSelect: (item: ItemSummary, e: MouseEvent) => void
  onOpen: (item: ItemSummary) => void
  onContextMenu: (item: ItemSummary, e: MouseEvent) => void
  onDragStart: (item: ItemSummary, e: DragEvent) => void
  onFocus: (item: ItemSummary) => void
  onRetry: (item: ItemSummary) => void
  /** Hover quick action: Quick Look for files, Open link for URLs. */
  onQuickAction?: (item: ItemSummary) => void
  /** Present inside a collection view: hover "Remove from collection". */
  onRemoveFromCollection?: (item: ItemSummary) => void
  onKeyDown?: (e: KeyboardEvent) => void
  entering?: boolean
}

/**
 * Body slot per type: `CARD_BODIES[type] = (item) => ReactNode`. Bodies fill the reserved rect
 * (the masonry decides the height); the caption below is shared.
 */
export interface CardBodyContext {
  /** True when the multi-select check badge occupies the top-left corner. */
  checked: boolean
}

export type CardBody = (item: ItemSummary, ctx: CardBodyContext) => ReactNode

/** Extension from the title when it has one (`report.final.PDF` -> `PDF`). */
export function fileExtension(title: string): string | null {
  const match = /\.([a-z0-9]{1,6})$/i.exec(title.trim())
  return match ? (match[1] as string).toUpperCase() : null
}

/**
 * URL for a text card: scheme dropped, zero-width break opportunities before `/ ? # & =` and after
 * `. - _` so long links wrap at path boundaries instead of mid-word.
 */
export function displayUrl(url: string): string {
  return url
    .replace(/^https?:\/\//i, '')
    .replace(/([/?#&=])/g, '\u200B$1')
    .replace(/([.\-_])(?=[^\s/])/g, '$1\u200B')
}

/** Excerpt for a text/note card: Markdown markers stripped so headings and emphasis read as prose. */
export function plainExcerpt(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/(^|\s)#{1,6}\s+/g, '$1')
    .replace(/^\s{0,3}(?:[-*+]|\d+\.)\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|[*_`~])/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function Favicon({ item }: { item: ItemSummary }): React.JSX.Element | null {
  const letter = item.domain?.replace(/^www\./, '').charAt(0)
  if (!item.faviconUrl && !letter) return null
  return (
    <span {...stylex.props(styles.favicon)} aria-hidden="true">
      {item.faviconUrl ? (
        <img {...stylex.props(styles.faviconImg)} src={item.faviconUrl} alt="" draggable={false} />
      ) : (
        <span {...stylex.props(styles.faviconLetter)}>{letter}</span>
      )}
    </span>
  )
}

function MediaBody(item: ItemSummary): ReactNode {
  return <Thumb style={styles.media} src={item.thumbnailUrl} fill={item.dominantColor} alt="" />
}

function VideoBody(item: ItemSummary): ReactNode {
  return (
    <>
      <Thumb style={styles.media} src={item.thumbnailUrl} fill={item.dominantColor} alt="" />
      <span {...stylex.props(styles.play)}>
        <span {...stylex.props(styles.playGlyph)}>
          <Play size={16} strokeWidth={1.5} fill="currentColor" />
        </span>
      </span>
      {item.durationMs ? <span {...stylex.props(styles.badge)}>{formatDuration(item.durationMs)}</span> : null}
    </>
  )
}

function RepoBody(item: ItemSummary, ctx: CardBodyContext): ReactNode {
  const name =
    item.card?.owner && item.title.startsWith(`${item.card.owner}/`)
      ? item.title.slice(item.card.owner.length + 1)
      : item.title
  return (
    <div {...stylex.props(styles.textBody, styles.repoBody)}>
      <span {...stylex.props(shared.eyebrow, ctx.checked && styles.eyebrowChecked)}>
        {item.card?.owner ?? 'GitHub'}
      </span>
      <span {...stylex.props(styles.repoTitle)}>{name}</span>
      {item.card?.description ? (
        <p {...stylex.props(styles.excerpt, styles.repoDescription)}>{item.card.description}</p>
      ) : null}
      <div {...stylex.props(styles.repoMeta)}>
        {item.card?.language ? (
          <span {...stylex.props(styles.repoStat)}>
            <span {...stylex.props(styles.langDot)} aria-hidden="true" />
            {item.card.language}
          </span>
        ) : null}
        {item.card?.stars !== null && item.card?.stars !== undefined ? (
          <span {...stylex.props(styles.repoStat)}>
            <Star size={12} strokeWidth={1.5} />
            {item.card.stars.toLocaleString()}
          </span>
        ) : null}
      </div>
    </div>
  )
}

function UrlBody(item: ItemSummary, ctx: CardBodyContext): ReactNode {
  if (item.subtype === 'github_repo') return RepoBody(item, ctx)
  const src = item.snapshotUrl ?? item.thumbnailUrl
  if (!src) {
    return (
      <div {...stylex.props(styles.textBody)}>
        <span {...stylex.props(shared.eyebrow, ctx.checked && styles.eyebrowChecked)}>{item.domain ?? 'Link'}</span>
        {item.understanding ? (
          <p {...stylex.props(styles.excerpt)}>{item.understanding}</p>
        ) : (
          <p {...stylex.props(styles.excerpt, styles.linkFallback)}>{item.url ? displayUrl(item.url) : ''}</p>
        )}
      </div>
    )
  }
  return (
    <>
      <Thumb style={styles.media} src={src} fill={item.dominantColor} alt="" />
      <Favicon item={item} />
      {item.subtype === 'youtube' ? (
        <span {...stylex.props(styles.play)}>
          <span {...stylex.props(styles.playGlyph)}>
            <Play size={16} strokeWidth={1.5} fill="currentColor" />
          </span>
        </span>
      ) : null}
      {item.subtype === 'youtube' && item.durationMs ? (
        <span {...stylex.props(styles.badge)}>{formatDuration(item.durationMs)}</span>
      ) : null}
    </>
  )
}

function PdfBody(item: ItemSummary): ReactNode {
  return (
    <>
      <Thumb style={styles.media} src={item.thumbnailUrl} fill={item.dominantColor ?? '#ece7dd'} fit="contain" alt="" />
      <span {...stylex.props(styles.badge)}>PDF</span>
    </>
  )
}

function TextBody(item: ItemSummary, ctx: CardBodyContext): ReactNode {
  return (
    <div {...stylex.props(styles.textBody)}>
      <span {...stylex.props(shared.eyebrow, ctx.checked && styles.eyebrowChecked)}>{typeLabel(item)}</span>
      <p {...stylex.props(styles.excerpt)}>{plainExcerpt(item.excerpt ?? item.understanding ?? item.title)}</p>
    </div>
  )
}

function NoteBody(item: ItemSummary, ctx: CardBodyContext): ReactNode {
  return (
    <div {...stylex.props(styles.textBody)}>
      <span {...stylex.props(shared.eyebrow, styles.noteEyebrow, ctx.checked && styles.eyebrowChecked)}>Note</span>
      <p {...stylex.props(styles.excerpt, styles.noteExcerpt)}>
        {plainExcerpt(item.excerpt ?? item.understanding ?? item.title)}
      </p>
    </div>
  )
}

function FileBody(item: ItemSummary): ReactNode {
  const ext = fileExtension(item.title)
  return (
    <div {...stylex.props(styles.fileTile)}>
      <span {...stylex.props(styles.fileGlyph)}>
        {item.type === 'audio' ? <Music size={24} strokeWidth={1.25} /> : <FileText size={24} strokeWidth={1.25} />}
      </span>
      {item.isMissing ? (
        <span {...stylex.props(styles.fileExt, styles.fileMissing)}>Original moved or deleted</span>
      ) : (
        <span {...stylex.props(styles.fileExt)}>{ext ?? typeLabel(item)}</span>
      )}
    </div>
  )
}

function AudioBody(item: ItemSummary): ReactNode {
  const ext = fileExtension(item.title)
  return (
    <div {...stylex.props(styles.fileTile)}>
      <Music size={22} strokeWidth={1.25} />
      {item.durationMs ? <span {...stylex.props(styles.audioDuration)}>{formatDuration(item.durationMs)}</span> : null}
      <span {...stylex.props(styles.fileExt)}>
        {ext ?? 'Audio'}
        {item.size ? <span {...stylex.props(styles.fileSub)}> · {formatBytes(item.size)}</span> : null}
      </span>
    </div>
  )
}

function FolderBody(item: ItemSummary): ReactNode {
  const thumbs = item.childThumbnailUrls.slice(0, 4)
  if (thumbs.length === 0) {
    return (
      <div {...stylex.props(styles.fileTile)}>
        <Folder size={28} strokeWidth={1.25} />
        <span {...stylex.props(styles.fileExt)}>
          {item.childCount > 0 ? `${item.childCount} ${item.childCount === 1 ? 'item' : 'items'}` : 'Folder'}
        </span>
      </div>
    )
  }
  return (
    <>
      <div {...stylex.props(styles.collage)}>
        {thumbs.map((src, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static list, never reordered
          <span key={`${item.id}-${i}`} {...stylex.props(styles.collageCell)}>
            <Thumb src={src} alt="" />
          </span>
        ))}
      </div>
      {item.childCount > thumbs.length ? <span {...stylex.props(styles.badge)}>{item.childCount}</span> : null}
    </>
  )
}

export const CARD_BODIES: Record<ItemSummary['type'], CardBody> = {
  image: MediaBody,
  video: VideoBody,
  url: UrlBody,
  pdf: PdfBody,
  text: TextBody,
  markdown: TextBody,
  note: NoteBody,
  folder: FolderBody,
  file: FileBody,
  audio: AudioBody,
  unknown: FileBody
}

function CardInner(props: ItemCardProps): React.JSX.Element {
  const { item, x, y, w, h, captionHeight, selected, focused, multi, entering } = props
  const body = CARD_BODIES[item.type](item, { checked: selected && multi })
  const working = !isTerminal(item.processingStatus)
  const failed = isFailed(item.processingStatus)
  const statusText = STATUS_LABEL[item.processingStatus]
  const secondary = secondaryLine(item)
  const quickDisabled = item.type !== 'url' && item.isMissing
  const quickLabel = item.type === 'url' ? 'Open link' : 'Quick Look'

  return (
    <article
      {...stylex.props(
        styles.card,
        styles.rect(x, y, w, h),
        item.isMissing && styles.missing,
        entering && styles.entering,
        stylex.defaultMarker()
      )}
      role="option"
      aria-selected={selected}
      aria-label={item.title}
      tabIndex={focused ? 0 : -1}
      data-item-id={item.id}
      draggable
      onDragStart={(e) => props.onDragStart(item, e)}
      onClick={(e) => props.onSelect(item, e)}
      onDoubleClick={() => props.onOpen(item)}
      onContextMenu={(e) => {
        e.preventDefault()
        props.onContextMenu(item, e)
      }}
      onFocus={() => props.onFocus(item)}
      onKeyDown={props.onKeyDown}
    >
      <div
        {...stylex.props(
          styles.body,
          item.type === 'note' && styles.paperBody,
          selected && styles.bodySelected,
          styles.bodyHeight(h - captionHeight)
        )}
      >
        {body}
        {selected && multi ? (
          <span {...stylex.props(styles.check)} aria-hidden="true">
            <Check size={12} strokeWidth={2.5} />
          </span>
        ) : null}
        <span {...stylex.props(styles.hover)}>
          {props.onRemoveFromCollection ? (
            <button
              type="button"
              {...stylex.props(shared.hoverFade, styles.quick)}
              aria-label="Remove from collection"
              title="Remove from collection"
              onClick={(e) => {
                e.stopPropagation()
                props.onRemoveFromCollection?.(item)
              }}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              <X size={14} strokeWidth={1.5} />
            </button>
          ) : null}
          {props.onQuickAction ? (
            <button
              type="button"
              {...stylex.props(shared.hoverFade, styles.quick)}
              aria-label={quickLabel}
              title={quickLabel}
              disabled={quickDisabled}
              onClick={(e) => {
                e.stopPropagation()
                props.onQuickAction?.(item)
              }}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              {item.type === 'url' ? <ArrowUpRight size={14} strokeWidth={1.5} /> : <Eye size={14} strokeWidth={1.5} />}
            </button>
          ) : null}
          <MenuTrigger onOpen={(e) => props.onContextMenu(item, e)} />
        </span>
      </div>
      <div {...stylex.props(styles.caption)}>
        <span {...stylex.props(styles.title, shared.ellipsis)}>{item.title}</span>
        <span {...stylex.props(styles.secondary)}>
          {working || failed || item.processingStatus === 'PARTIAL' ? (
            <Dot tone={toneForStatus(item.processingStatus)} />
          ) : null}
          <span {...stylex.props(shared.ellipsis)}>{working || failed ? statusText : secondary}</span>
          {failed ? (
            <button
              type="button"
              {...stylex.props(styles.retry)}
              onClick={(e) => {
                e.stopPropagation()
                props.onRetry(item)
              }}
            >
              Try again
            </button>
          ) : null}
        </span>
      </div>
    </article>
  )
}

/** Generic item card. Memoised: only re-renders when its own item/rect/selection changes. */
export const ItemCard = memo(CardInner)
