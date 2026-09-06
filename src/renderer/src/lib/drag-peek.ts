/**
 * Guess what a drag in flight is, from the little a `dragover` is allowed to see. Kept free of DOM
 * types so it runs under the node test config; `DragMeta` is the slice of `DataTransfer` it reads.
 */
import { INTERNAL_DND_MIME } from '../../../shared/constants'

export type DragPeekKind = 'link' | 'pdf' | 'image' | 'video' | 'audio' | 'text' | 'folder' | 'file' | 'mixed'

export interface DragPeek {
  /** Overall kind; `mixed` when the parts differ. */
  kind: DragPeekKind
  /** Number of things being dragged (1 for a link or a text snippet). */
  count: number
  /** Distinct kinds and how many of each, most numerous first. */
  parts: Array<{ kind: DragPeekKind; count: number }>
}

/** The parts of a `DataTransfer` readable mid-drag: type names and item kinds, never contents. */
export interface DragMeta {
  types: ArrayLike<string> | Iterable<string>
  items?: ArrayLike<{ kind: string; type: string }> | Iterable<{ kind: string; type: string }>
}

/**
 * Display only: this drives the hover hint, while the intake still classifies the real drop from
 * the raw snapshot. Finder gives folders a `file` item with an empty type, the same as files of
 * unknown type, so `folders` (counted by the drag sidecar, 0 without it) is how many of those
 * empty-type items to call folders. Only the tally matters, so which ones is irrelevant.
 */
export function peekDrag(dt: DragMeta | null, folders = 0): DragPeek | null {
  if (!dt) return null
  const types = Array.from(dt.types)
  if (types.includes(INTERNAL_DND_MIME)) return null
  const files = Array.from(dt.items ?? []).filter((i) => i.kind === 'file')
  if (files.length > 0) {
    const tally = new Map<DragPeekKind, number>()
    let untyped = folders
    for (const f of files) {
      const k = f.type === '' && untyped-- > 0 ? 'folder' : kindForMime(f.type)
      tally.set(k, (tally.get(k) ?? 0) + 1)
    }
    const parts = [...tally].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count)
    return { kind: parts.length === 1 ? parts[0]!.kind : 'mixed', count: files.length, parts }
  }
  const single = (kind: DragPeekKind): DragPeek => ({ kind, count: 1, parts: [{ kind, count: 1 }] })
  if (types.includes('Files')) return single('file')
  if (types.includes('text/uri-list')) return single('link')
  if (types.includes('text/plain') || types.includes('text/html')) return single('text')
  return null
}

function kindForMime(mime: string): DragPeekKind {
  if (mime === 'application/pdf') return 'pdf'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('text/') || mime === 'application/json') return 'text'
  if (mime === 'inode/directory' || mime === 'application/x-directory') return 'folder'
  return 'file'
}

const ONE: Record<DragPeekKind, string> = {
  link: 'Link',
  pdf: 'PDF',
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  text: 'Text',
  folder: 'Folder',
  file: 'File',
  mixed: 'Files'
}

const MANY: Record<DragPeekKind, string> = {
  link: 'links',
  pdf: 'PDFs',
  image: 'images',
  video: 'videos',
  audio: 'audio files',
  text: 'text files',
  folder: 'folders',
  file: 'files',
  mixed: 'items'
}

/** Mid-sentence singular, for "1 link + 1 PDF". */
const EACH: Record<DragPeekKind, string> = {
  link: 'link',
  pdf: 'PDF',
  image: 'image',
  video: 'video',
  audio: 'audio file',
  text: 'text file',
  folder: 'folder',
  file: 'file',
  mixed: 'item'
}

/**
 * Label for the hover hint: "Link", "3 images", "1 link + 1 PDF". A pair of different things is
 * spelled out; from three up a mixed set is just "N items".
 */
export function dragPeekLabel(peek: DragPeek): string {
  if (peek.count <= 1) return ONE[peek.kind]
  if (peek.count === 2 && peek.parts.length === 2) return peek.parts.map((p) => `1 ${EACH[p.kind]}`).join(' + ')
  return `${peek.count} ${MANY[peek.kind]}`
}
