import { KIND_LABEL } from '../../../shared/kinds'
import { isTerminal, STATUS_LABEL } from '../../../shared/status'
import { formatBytes, formatDuration, relativeTime } from '../../../shared/text'
import type { ItemSubtype, ItemSummary, ItemType } from '../../../shared/types'

export { formatBytes, formatDuration }

/** Relative time against the current clock. */
export function ago(iso: string, now: Date = new Date()): string {
  return relativeTime(iso, now.toISOString())
}

const TYPE_LABEL: Record<ItemType, string> = {
  file: 'File',
  folder: 'Folder',
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  pdf: 'PDF',
  text: 'Text',
  markdown: 'Markdown',
  url: 'Link',
  note: 'Note',
  unknown: 'File'
}

const SUBTYPE_LABEL: Partial<Record<ItemSubtype, string>> = {
  github_repo: 'Repository',
  article: 'Article',
  youtube: 'Video',
  tweet: 'Post',
  product: 'Product',
  docs: 'Docs',
  paper: 'Paper',
  figma: 'Figma',
  social: 'Post',
  screenshot: 'Screenshot',
  photo: 'Photo',
  design: 'Design',
  document: 'Document',
  spreadsheet: 'Spreadsheet',
  presentation: 'Slides',
  archive: 'Archive',
  code: 'Code',
  data: 'Data'
}

/** Subtype when meaningful, then kind, then the type. */
export function typeLabel(item: Pick<ItemSummary, 'type' | 'subtype' | 'kind'>): string {
  if (item.subtype && SUBTYPE_LABEL[item.subtype]) return SUBTYPE_LABEL[item.subtype] as string
  if (item.kind && item.kind !== 'other') return KIND_LABEL[item.kind]
  return TYPE_LABEL[item.type]
}

/** Secondary line under a card title: domain / size / count / status, whichever says most. */
export function secondaryLine(item: ItemSummary, now: Date = new Date()): string {
  const parts: string[] = []
  if (!isTerminal(item.processingStatus)) {
    const label = STATUS_LABEL[item.processingStatus]
    if (label) return label
  }
  if (item.isMissing) return 'Original moved or deleted'
  if (item.type === 'url' && item.domain) parts.push(item.domain)
  else if (item.type === 'folder') parts.push(`${item.childCount} ${item.childCount === 1 ? 'item' : 'items'}`)
  else if (item.type === 'pdf' && item.pageCount)
    parts.push(`${item.pageCount} ${item.pageCount === 1 ? 'page' : 'pages'}`)
  else if (item.type === 'video' && item.durationMs) parts.push(formatDuration(item.durationMs))
  else if (item.size && item.type !== 'note' && item.type !== 'text') parts.push(formatBytes(item.size))
  else parts.push(typeLabel(item))
  parts.push(ago(item.capturedAt, now))
  return parts.join(' · ')
}

/** Pluralise with a count: `count(3, 'item')` -> "3 items". */
export function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`
}

/** Card copy for a status, falling back to nothing for READY. */
export function statusLabel(item: Pick<ItemSummary, 'processingStatus'>): string {
  return STATUS_LABEL[item.processingStatus]
}

/** Format a ⌘-style shortcut for display on the current platform. */
export function shortcut(keys: string, platform: 'darwin' | 'other' = 'darwin'): string {
  return platform === 'darwin' ? keys : keys.replace('⌘', 'Ctrl+').replace('⇧', 'Shift+')
}
