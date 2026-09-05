import { LIMITS } from '../../../shared/constants'
import { toMediaUrl } from '../../../shared/media'
import { isProcessingStatus } from '../../../shared/status'
import { truncate } from '../../../shared/text'
import type {
  Item,
  ItemCardFacts,
  ItemMetadata,
  ItemSummary,
  ItemsSort,
  ItemsView,
  SystemStats
} from '../../../shared/types'
import type { Db, SqlValue } from '../db'
import {
  chunk,
  json,
  num,
  numOr,
  parseJson,
  parseStringArray,
  placeholders,
  type Row,
  requireText,
  text,
  toBool
} from './rows'

/** `Item` property -> SQL column and encoding. */
type ColumnKind = 'text' | 'num' | 'bool' | 'json'

const COLUMNS: Record<keyof Item, { col: string; kind: ColumnKind }> = {
  id: { col: 'id', kind: 'text' },
  type: { col: 'type', kind: 'text' },
  subtype: { col: 'subtype', kind: 'text' },
  kind: { col: 'kind', kind: 'text' },
  title: { col: 'title', kind: 'text' },
  originalPath: { col: 'original_path', kind: 'text' },
  managedPath: { col: 'managed_path', kind: 'text' },
  url: { col: 'url', kind: 'text' },
  canonicalUrl: { col: 'canonical_url', kind: 'text' },
  domain: { col: 'domain', kind: 'text' },
  mimeType: { col: 'mime_type', kind: 'text' },
  size: { col: 'size', kind: 'num' },
  contentHash: { col: 'content_hash', kind: 'text' },
  width: { col: 'width', kind: 'num' },
  height: { col: 'height', kind: 'num' },
  durationMs: { col: 'duration_ms', kind: 'num' },
  pageCount: { col: 'page_count', kind: 'num' },
  createdAt: { col: 'created_at', kind: 'text' },
  capturedAt: { col: 'captured_at', kind: 'text' },
  modifiedAt: { col: 'modified_at', kind: 'text' },
  lastKeptAt: { col: 'last_kept_at', kind: 'text' },
  captureBatchId: { col: 'capture_batch_id', kind: 'text' },
  processingStatus: { col: 'processing_status', kind: 'text' },
  processingError: { col: 'processing_error', kind: 'text' },
  understanding: { col: 'understanding', kind: 'text' },
  whyUseful: { col: 'why_useful', kind: 'text' },
  topics: { col: 'topics', kind: 'json' },
  entities: { col: 'entities', kind: 'json' },
  visionText: { col: 'vision_text', kind: 'text' },
  retrievalHints: { col: 'retrieval_hints', kind: 'json' },
  suggestedActions: { col: 'suggested_actions', kind: 'json' },
  aiConfidence: { col: 'ai_confidence', kind: 'num' },
  metadata: { col: 'metadata', kind: 'json' },
  extractedText: { col: 'extracted_text', kind: 'text' },
  excerpt: { col: 'excerpt', kind: 'text' },
  thumbnailPath: { col: 'thumbnail_path', kind: 'text' },
  snapshotPath: { col: 'snapshot_path', kind: 'text' },
  faviconPath: { col: 'favicon_path', kind: 'text' },
  dominantColor: { col: 'dominant_color', kind: 'text' },
  mediaVersion: { col: 'media_version', kind: 'num' },
  parentItemId: { col: 'parent_item_id', kind: 'text' },
  userOverrides: { col: 'user_overrides', kind: 'json' },
  isMissing: { col: 'is_missing', kind: 'bool' },
  missingCheckedAt: { col: 'missing_checked_at', kind: 'text' },
  deletedAt: { col: 'deleted_at', kind: 'text' }
}

const ITEM_KEYS = Object.keys(COLUMNS) as (keyof Item)[]

/** Item properties that feed the FTS row; writes touching any of them resync `items_fts`. */
export const FTS_KEYS: ReadonlySet<keyof Item> = new Set<keyof Item>([
  'title',
  'retrievalHints',
  'topics',
  'entities',
  'understanding',
  'whyUseful',
  'visionText',
  'metadata',
  'extractedText',
  'domain',
  'kind',
  'deletedAt'
])

function encode(kind: ColumnKind, value: unknown): SqlValue {
  if (value === undefined || value === null) return null
  switch (kind) {
    case 'text':
      return String(value)
    case 'num':
      return typeof value === 'number' ? value : Number(value)
    case 'bool':
      return value ? 1 : 0
    case 'json':
      return json(value)
  }
}

/** Map a raw `items` row to an `Item` (JSON parsed, booleans decoded). */
export function rowToItem(row: Row): Item {
  const status = row.processing_status
  return {
    id: requireText(row.id, 'id'),
    type: requireText(row.type, 'type') as Item['type'],
    subtype: text(row.subtype) as Item['subtype'],
    kind: text(row.kind) as Item['kind'],
    title: requireText(row.title, 'title'),
    originalPath: text(row.original_path),
    managedPath: text(row.managed_path),
    url: text(row.url),
    canonicalUrl: text(row.canonical_url),
    domain: text(row.domain),
    mimeType: text(row.mime_type),
    size: num(row.size),
    contentHash: text(row.content_hash),
    width: num(row.width),
    height: num(row.height),
    durationMs: num(row.duration_ms),
    pageCount: num(row.page_count),
    createdAt: requireText(row.created_at, 'created_at'),
    capturedAt: requireText(row.captured_at, 'captured_at'),
    modifiedAt: requireText(row.modified_at, 'modified_at'),
    lastKeptAt: requireText(row.last_kept_at, 'last_kept_at'),
    captureBatchId: text(row.capture_batch_id),
    processingStatus: isProcessingStatus(status) ? status : 'CAPTURED',
    processingError: text(row.processing_error),
    understanding: text(row.understanding),
    whyUseful: text(row.why_useful),
    topics: parseStringArray(row.topics),
    entities: parseStringArray(row.entities),
    visionText: text(row.vision_text),
    retrievalHints: parseStringArray(row.retrieval_hints),
    suggestedActions: parseStringArray(row.suggested_actions) as Item['suggestedActions'],
    aiConfidence: num(row.ai_confidence),
    metadata: parseJson<ItemMetadata>(row.metadata, {}),
    extractedText: text(row.extracted_text),
    excerpt: text(row.excerpt),
    thumbnailPath: text(row.thumbnail_path),
    snapshotPath: text(row.snapshot_path),
    faviconPath: text(row.favicon_path),
    dominantColor: text(row.dominant_color),
    mediaVersion: numOr(row.media_version, 1),
    parentItemId: text(row.parent_item_id),
    userOverrides: parseJson<Item['userOverrides']>(row.user_overrides, {}),
    isMissing: toBool(row.is_missing),
    missingCheckedAt: text(row.missing_checked_at),
    deletedAt: text(row.deleted_at)
  }
}

/** Flatten `metadata` into the FTS `meta_text` column (descriptions, repo facts, names). */
export function metaText(metadata: ItemMetadata): string {
  const parts: string[] = []
  const push = (v: unknown): void => {
    if (typeof v === 'string' && v.trim().length > 0) parts.push(v.trim())
    else if (Array.isArray(v)) for (const x of v) if (typeof x === 'string') parts.push(x)
  }
  push(metadata.description)
  push(metadata.siteName)
  push(metadata.originalName)
  push(metadata.sourceUrl)
  push(metadata.headings)
  if (metadata.og) {
    push(metadata.og.title)
    push(metadata.og.description)
    push(metadata.og.siteName)
  }
  if (metadata.repo) {
    push(metadata.repo.owner)
    push(metadata.repo.name)
    push(metadata.repo.description)
    push(metadata.repo.language)
    push(metadata.repo.topics)
  }
  if (metadata.folder) push(Object.keys(metadata.folder.extensions ?? {}))
  return parts.join(' ')
}

/** Facts needed to turn `Item`s into `ItemSummary`s in one pass. */
export interface SummaryFacts {
  collectionIds: Map<string, string[]>
  children: Map<string, { count: number; thumbnailUrls: string[] }>
}

function cardFacts(item: Item): ItemCardFacts | undefined {
  const repo = item.metadata.repo
  if (!repo) return undefined
  return {
    language: repo.language ?? null,
    stars: typeof repo.stars === 'number' ? repo.stars : null,
    description: repo.description ?? null,
    owner: repo.owner ?? null
  }
}

/** Build the card payload. Media URLs are created here and only here. */
export function toSummary(item: Item, facts?: SummaryFacts): ItemSummary {
  const children = facts?.children.get(item.id)
  const card = cardFacts(item)
  const summary: ItemSummary = {
    id: item.id,
    type: item.type,
    subtype: item.subtype,
    kind: item.kind,
    title: item.title,
    domain: item.domain,
    url: item.url,
    thumbnailUrl: item.thumbnailPath ? toMediaUrl('thumbs', item.thumbnailPath, item.mediaVersion) : null,
    snapshotUrl: item.snapshotPath ? toMediaUrl('snapshots', item.snapshotPath, item.mediaVersion) : null,
    faviconUrl: item.faviconPath ? toMediaUrl('objects', item.faviconPath, item.mediaVersion) : null,
    dominantColor: item.dominantColor,
    width: item.width,
    height: item.height,
    size: item.size,
    mimeType: item.mimeType,
    durationMs: item.durationMs,
    pageCount: item.pageCount,
    excerpt: item.excerpt,
    capturedAt: item.capturedAt,
    createdAt: item.createdAt,
    processingStatus: item.processingStatus,
    processingError: item.processingError,
    understanding: item.understanding ? truncate(item.understanding, LIMITS.summaryUnderstandingMaxChars) : null,
    collectionIds: facts?.collectionIds.get(item.id) ?? [],
    // Folders are captured as one item with a manifest, so the file count comes from metadata.
    childCount: children?.count || (item.metadata.folder?.fileCount ?? 0),
    childThumbnailUrls: children?.thumbnailUrls ?? [],
    isMissing: item.isMissing,
    parentItemId: item.parentItemId
  }
  if (card) summary.card = card
  return summary
}

/** `items:list` query as the repository understands it. */
export interface ItemListQuery {
  view: ItemsView
  collectionId?: string
  types?: Item['type'][]
  sort?: ItemsSort
  limit?: number
  offset?: number
}

/** Row access, FTS sync and summary assembly. Callers own transactions. */
export interface ItemRepo {
  insert(item: Item): void
  get(id: string): Item | null
  getMany(ids: readonly string[]): Item[]
  /** Update the given columns; resyncs FTS when an indexed field (`FTS_KEYS`) is touched. */
  update(id: string, patch: Partial<Item>): void
  /** `metadata = json_patch(metadata, patch)` (null values delete keys) and resync FTS. */
  patchMetadata(id: string, patch: Record<string, unknown>): void
  /** Set/clear `deleted_at` and resync FTS. */
  setDeleted(ids: readonly string[], deletedAt: string | null): void
  /** Hard delete (cascades to memberships, relationships, embeddings, jobs) and drop FTS rows. */
  deleteForever(ids: readonly string[]): void
  /** Rebuild the FTS row for one item (deleted items have none). */
  syncFts(id: string): void
  list(query: ItemListQuery): Item[]
  children(parentId: string): Item[]
  siblings(batchId: string): Item[]
  findByHash(hash: string): Item | null
  findByCanonicalUrl(canonicalUrl: string): Item | null
  /** Ids of every non-deleted item (for `items:reprocessAll`). */
  allIds(): string[]
  summaryFacts(ids: readonly string[]): SummaryFacts
  summaries(items: readonly Item[]): ItemSummary[]
  summary(id: string): ItemSummary | null
  stats(): Omit<SystemStats, 'aiStatus'>
  count(): number
}

export function createItemRepo(db: Db): ItemRepo {
  const insertSql = `INSERT INTO items (${ITEM_KEYS.map((k) => COLUMNS[k].col).join(', ')}) VALUES (${placeholders(ITEM_KEYS.length)})`

  const syncFts = (id: string): void => {
    db.prepare('DELETE FROM items_fts WHERE item_id = ?').run(id)
    const row = db.prepare('SELECT * FROM items WHERE id = ? AND deleted_at IS NULL').get(id) as Row | undefined
    if (!row) return
    const item = rowToItem(row)
    db.prepare(
      `INSERT INTO items_fts (item_id, title, retrieval_hints, topics, entities, understanding, why_useful,
                              vision_text, meta_text, extracted_text, domain, kind)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      item.id,
      item.title,
      item.retrievalHints.join(' '),
      item.topics.join(' '),
      item.entities.join(' '),
      item.understanding ?? '',
      item.whyUseful ?? '',
      item.visionText ?? '',
      metaText(item.metadata),
      item.extractedText ?? '',
      item.domain ?? '',
      item.kind ?? ''
    )
  }

  const get = (id: string): Item | null => {
    const row = db.prepare('SELECT * FROM items WHERE id = ?').get(id) as Row | undefined
    return row ? rowToItem(row) : null
  }

  const getMany = (ids: readonly string[]): Item[] => {
    const out: Item[] = []
    for (const part of chunk(ids)) {
      const rows = db.prepare(`SELECT * FROM items WHERE id IN (${placeholders(part.length)})`).all(...part) as Row[]
      out.push(...rows.map(rowToItem))
    }
    const order = new Map(ids.map((id, i) => [id, i]))
    return out.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
  }

  const summaryFacts = (ids: readonly string[]): SummaryFacts => {
    const collectionIds = new Map<string, string[]>()
    const children = new Map<string, { count: number; thumbnailUrls: string[] }>()
    for (const part of chunk(ids)) {
      const members = db
        .prepare(
          `SELECT item_id, collection_id FROM collection_items WHERE item_id IN (${placeholders(part.length)}) ORDER BY added_at`
        )
        .all(...part) as Row[]
      for (const m of members) {
        const itemId = String(m.item_id)
        const list = collectionIds.get(itemId) ?? []
        list.push(String(m.collection_id))
        collectionIds.set(itemId, list)
      }
      const kids = db
        .prepare(
          `SELECT parent_item_id, thumbnail_path, media_version FROM items
           WHERE parent_item_id IN (${placeholders(part.length)}) AND deleted_at IS NULL ORDER BY captured_at, title`
        )
        .all(...part) as Row[]
      for (const k of kids) {
        const parent = String(k.parent_item_id)
        const entry = children.get(parent) ?? { count: 0, thumbnailUrls: [] }
        entry.count += 1
        const thumb = text(k.thumbnail_path)
        if (thumb && entry.thumbnailUrls.length < 4) {
          entry.thumbnailUrls.push(toMediaUrl('thumbs', thumb, numOr(k.media_version, 1)))
        }
        children.set(parent, entry)
      }
    }
    return { collectionIds, children }
  }

  const summaries = (items: readonly Item[]): ItemSummary[] => {
    const facts = summaryFacts(items.map((i) => i.id))
    return items.map((item) => toSummary(item, facts))
  }

  const list = (query: ItemListQuery): Item[] => {
    const where: string[] = []
    const params: SqlValue[] = []
    let join = ''
    switch (query.view) {
      case 'trash':
        where.push('i.deleted_at IS NOT NULL')
        break
      case 'collection':
        join = 'JOIN collection_items ci ON ci.item_id = i.id'
        where.push('ci.collection_id = ?', 'i.deleted_at IS NULL')
        params.push(query.collectionId ?? '')
        break
      case 'links':
        where.push('i.deleted_at IS NULL', 'i.parent_item_id IS NULL', "i.type = 'url'")
        break
      case 'files':
        where.push('i.deleted_at IS NULL', 'i.parent_item_id IS NULL', "i.type NOT IN ('url', 'note')")
        break
      case 'library':
        where.push('i.deleted_at IS NULL', 'i.parent_item_id IS NULL')
        break
    }
    if (query.types && query.types.length > 0) {
      where.push(`i.type IN (${placeholders(query.types.length)})`)
      params.push(...query.types)
    }
    const order =
      query.sort === 'title'
        ? 'i.title COLLATE NOCASE ASC, i.captured_at DESC'
        : query.sort === 'created'
          ? 'i.created_at DESC'
          : query.view === 'trash'
            ? 'i.deleted_at DESC'
            : 'i.captured_at DESC'
    const limit = Math.min(Math.max(query.limit ?? 500, 1), 5000)
    const offset = Math.max(query.offset ?? 0, 0)
    const sql = `SELECT i.* FROM items i ${join} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`
    return (db.prepare(sql).all(...params, limit, offset) as Row[]).map(rowToItem)
  }

  return {
    insert(item) {
      db.prepare(insertSql).run(...ITEM_KEYS.map((k) => encode(COLUMNS[k].kind, item[k])))
      syncFts(item.id)
    },
    get,
    getMany,
    update(id, patch) {
      const sets: string[] = []
      const params: SqlValue[] = []
      let touchesFts = false
      for (const key of ITEM_KEYS) {
        if (key === 'id' || !(key in patch)) continue
        sets.push(`${COLUMNS[key].col} = ?`)
        params.push(encode(COLUMNS[key].kind, patch[key]))
        if (FTS_KEYS.has(key)) touchesFts = true
      }
      if (sets.length === 0) return
      db.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`).run(...params, id)
      if (touchesFts) syncFts(id)
    },
    patchMetadata(id, patch) {
      db.prepare('UPDATE items SET metadata = json_patch(metadata, ?) WHERE id = ?').run(json(patch), id)
      syncFts(id)
    },
    setDeleted(ids, deletedAt) {
      for (const part of chunk(ids)) {
        db.prepare(`UPDATE items SET deleted_at = ? WHERE id IN (${placeholders(part.length)})`).run(deletedAt, ...part)
      }
      for (const id of ids) syncFts(id)
    },
    deleteForever(ids) {
      for (const part of chunk(ids)) {
        db.prepare(`DELETE FROM items_fts WHERE item_id IN (${placeholders(part.length)})`).run(...part)
        db.prepare(`DELETE FROM items WHERE id IN (${placeholders(part.length)})`).run(...part)
      }
    },
    syncFts,
    list,
    children(parentId) {
      return (
        db
          .prepare('SELECT * FROM items WHERE parent_item_id = ? AND deleted_at IS NULL ORDER BY title COLLATE NOCASE')
          .all(parentId) as Row[]
      ).map(rowToItem)
    },
    siblings(batchId) {
      return (
        db
          .prepare('SELECT * FROM items WHERE capture_batch_id = ? AND deleted_at IS NULL ORDER BY captured_at')
          .all(batchId) as Row[]
      ).map(rowToItem)
    },
    findByHash(hash) {
      const row = db
        .prepare('SELECT * FROM items WHERE content_hash = ? AND deleted_at IS NULL ORDER BY captured_at LIMIT 1')
        .get(hash) as Row | undefined
      return row ? rowToItem(row) : null
    },
    findByCanonicalUrl(canonicalUrl) {
      const row = db
        .prepare('SELECT * FROM items WHERE canonical_url = ? AND deleted_at IS NULL ORDER BY captured_at LIMIT 1')
        .get(canonicalUrl) as Row | undefined
      return row ? rowToItem(row) : null
    },
    allIds() {
      return (db.prepare('SELECT id FROM items WHERE deleted_at IS NULL ORDER BY captured_at').all() as Row[]).map(
        (r) => String(r.id)
      )
    },
    summaryFacts,
    summaries,
    summary(id) {
      const item = get(id)
      return item ? toSummary(item, summaryFacts([id])) : null
    },
    stats() {
      const row = db
        .prepare(
          `SELECT (SELECT count(*) FROM items WHERE deleted_at IS NULL) AS items,
                  (SELECT count(*) FROM relationships) AS connections,
                  (SELECT count(*) FROM collections) AS collections,
                  (SELECT count(*) FROM items WHERE deleted_at IS NULL AND processing_status NOT IN ('READY', 'PARTIAL')) AS processing`
        )
        .get() as Row
      return {
        items: numOr(row.items, 0),
        connections: numOr(row.connections, 0),
        collections: numOr(row.collections, 0),
        processing: numOr(row.processing, 0)
      }
    },
    count() {
      return numOr((db.prepare('SELECT count(*) AS n FROM items WHERE deleted_at IS NULL').get() as Row).n, 0)
    }
  }
}
