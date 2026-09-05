/**
 * Text views of items used by retrieval and the agent: the memory document embedded as chunk 0,
 * body chunking for chunks ≥ 1, the compact item card the agent reads, and a budgeted context
 * builder. Pure functions over `Item`.
 */

import { LIMITS } from '../../shared/constants'
import { KIND_LABEL } from '../../shared/kinds'
import { relativeTime, truncate } from '../../shared/text'
import type { Item } from '../../shared/types'
import { estimateTokens } from '../ai/messages'

/** Everything a person might remember about an item, in one string. */
export function memoryDocument(item: Item): string {
  const parts: string[] = [item.title]
  if (item.kind) parts.push(KIND_LABEL[item.kind])
  if (item.domain) parts.push(item.domain)
  if (item.understanding) parts.push(item.understanding)
  if (item.whyUseful) parts.push(item.whyUseful)
  if (item.topics.length > 0) parts.push(item.topics.join(', '))
  if (item.entities.length > 0) parts.push(item.entities.join(', '))
  if (item.visionText) parts.push(truncate(item.visionText, 1_200))
  if (item.retrievalHints.length > 0) parts.push(item.retrievalHints.join('; '))
  if (!item.understanding && item.excerpt) parts.push(item.excerpt)
  return parts.join('\n')
}

/**
 * Split body text into ~`size`-char chunks on paragraph / sentence boundaries, at most `max`.
 * Whitespace-only input yields no chunks.
 */
export function bodyChunks(
  text: string | null | undefined,
  size: number = LIMITS.bodyChunkChars,
  max: number = LIMITS.maxBodyChunks
): string[] {
  if (!text) return []
  const normalized = text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim()
  if (normalized.length === 0) return []
  const units = normalized.split(/\n{2,}|(?<=[.!?])\s+(?=[A-Z0-9"“(])/).filter((u) => u.trim().length > 0)
  const chunks: string[] = []
  let current = ''
  const flush = (): void => {
    if (current.trim().length > 0) chunks.push(current.trim())
    current = ''
  }
  for (const unit of units) {
    if (unit.length > size) {
      flush()
      for (let i = 0; i < unit.length && chunks.length < max; i += size) chunks.push(unit.slice(i, i + size).trim())
      if (chunks.length >= max) break
      continue
    }
    if (current.length + unit.length + 1 > size) {
      flush()
      if (chunks.length >= max) break
    }
    current = current.length === 0 ? unit : `${current}\n${unit}`
  }
  if (chunks.length < max) flush()
  return chunks.slice(0, max)
}

/** Compact facts shown on an agent card. */
export interface ItemCard {
  id: string
  title: string
  type: string
  kind: string | null
  domain: string | null
  url: string | null
  capturedAgo: string
  understanding: string | null
  whyUseful: string | null
  topics: string[]
  entities: string[]
  excerpt: string | null
  facts: Record<string, string | number>
  /** Length of the readable content, so the model knows whether `read_document` is worth it. */
  contentChars: number
}

export interface CardOptions {
  nowIso: string
  /** Cap on excerpt characters (default `LIMITS.excerptChars`). */
  excerptChars?: number
  /** Drop long fields (excerpt, whyUseful) for thin candidate lists. */
  thin?: boolean
}

export function itemCard(item: Item, opts: CardOptions): ItemCard {
  const facts: Record<string, string | number> = {}
  const repo = item.metadata.repo
  if (repo) {
    if (repo.language) facts.language = repo.language
    if (typeof repo.stars === 'number') facts.stars = repo.stars
    if (repo.owner) facts.owner = repo.owner
  }
  if (item.pageCount) facts.pages = item.pageCount
  if (item.metadata.folder) facts.files = item.metadata.folder.fileCount
  if (item.width && item.height) facts.dimensions = `${item.width}×${item.height}`
  if (item.metadata.siteName) facts.site = String(item.metadata.siteName)
  const excerptSource = item.excerpt ?? item.extractedText ?? null
  const card: ItemCard = {
    id: item.id,
    title: item.title,
    type: item.subtype ? `${item.type}/${item.subtype}` : item.type,
    kind: item.kind,
    domain: item.domain,
    url: item.url,
    capturedAgo: relativeTime(item.capturedAt, opts.nowIso),
    understanding: item.understanding ? truncate(item.understanding, opts.thin ? 140 : 400) : null,
    whyUseful: opts.thin ? null : item.whyUseful,
    topics: item.topics.slice(0, opts.thin ? 4 : 6),
    entities: item.entities.slice(0, opts.thin ? 4 : 8),
    excerpt:
      opts.thin || !excerptSource
        ? null
        : truncate(excerptSource.replace(/\s+/g, ' '), opts.excerptChars ?? LIMITS.excerptChars),
    facts,
    contentChars: item.extractedText?.length ?? 0
  }
  return card
}

/** Cards for `items` within a token budget (order preserved; later items are dropped first). */
export function contextCards(items: readonly Item[], tokenBudget: number, opts: CardOptions): ItemCard[] {
  const out: ItemCard[] = []
  let used = 0
  for (const item of items) {
    const card = itemCard(item, opts)
    const cost = estimateTokens(JSON.stringify(card))
    if (used + cost > tokenBudget && out.length > 0) break
    out.push(card)
    used += cost
  }
  return out
}

/** Text of an item the agent can read: extracted text (or excerpt/understanding as a last resort). */
export function readableText(item: Item): string {
  if (item.extractedText && item.extractedText.trim().length > 0) return item.extractedText
  const parts = [item.understanding, item.visionText, item.excerpt].filter(
    (s): s is string => !!s && s.trim().length > 0
  )
  return parts.join('\n\n')
}
