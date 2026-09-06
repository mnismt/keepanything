/**
 * `createRetrieval`: FTS5 + in-memory vectors fused with weighted RRF, item
 * indexing (FTS row + memory-document embedding), body-chunk embeddings, similar items, collection
 * centroids and the compact context the agent reads. Pure main-side module: no `electron`, no
 * `process.env`; the embedding provider and repositories arrive through deps.
 */

import { EMBEDDING_DIMS, LIMITS } from '../../shared/constants'
import { toMediaUrl } from '../../shared/media'
import { relativeTime, truncate } from '../../shared/text'
import type { Candidate, Item, SearchFilters, SearchHit } from '../../shared/types'
import type { OrganizeCandidate } from '../ai/prompts'
import type { Clock, CollectionCandidate, EmbeddingProvider, Logger, QuickSearchOptions, Retrieval } from '../ports'
import type { Db } from '../storage/db'
import type { Repositories } from '../storage/repositories'
import type { EmbeddingRow } from '../storage/repositories/embedding-repo'
import type { Row } from '../storage/repositories/rows'
import { bodyChunks, contextCards, type ItemCard, memoryDocument } from './context'
import { type FtsHit, ftsSearch, SNIPPET_CLOSE, SNIPPET_OPEN } from './fts'
import { type FusedHit, fuse } from './hybrid'
import { buildBagMatch, buildMatch, type ParsedQuery, parseQuery } from './query'
import { dot, type VectorEntry, type VectorHit, VectorIndex } from './vectors'

export { bodyChunks, contextCards, type ItemCard, itemCard, memoryDocument, readableText } from './context'
export { FTS_COLUMNS, type FtsHit, ftsSearch, SNIPPET_CLOSE, SNIPPET_OPEN } from './fts'
export { defaultVectorWeight, type FusedHit, fuse, matchesTypeCue, RRF_K, recencyBoost, timeBoost } from './hybrid'
export {
  buildBagMatch,
  buildMatch,
  type ParsedQuery,
  parseQuery,
  parseTimeCue,
  type QueryCues,
  type TimeCue
} from './query'
export { centroidOf, dot, type VectorEntry, type VectorHit, VectorIndex } from './vectors'

export interface RetrievalDeps {
  db: Db
  repos: Repositories
  /** Absent -> FTS only. */
  embeddings?: EmbeddingProvider
  logger: Logger
  clock: Clock
}

/** A search hit with the product-voice reason it ranked (extra field over `SearchHit`). */
export interface RetrievalHit extends SearchHit {
  reason: string
}

export interface EmbedBodyResult {
  chunks: number
  model: string | null
  /** True when nothing was embedded (no provider, no text, or a big folder's child). */
  skipped: boolean
  /** True when the stored rows already matched (idempotent no-op). */
  unchanged: boolean
}

/** The `Retrieval` port plus what the stages and the agent need on top. */
export interface RetrievalService extends Retrieval {
  quickSearch(query: string, opts?: QuickSearchOptions): Promise<RetrievalHit[]>
  /** Embed body chunks (chunk_index ≥ 1) for an item; idempotent on unchanged text and model. */
  embedBody(itemId: string): Promise<EmbedBodyResult>
  /** Thin candidates for relate/organize: cosine top-k ∪ FTS bag ∪ deterministic signals. */
  candidatesFor(itemId: string, opts?: { k?: number }): Promise<OrganizeCandidate[]>
  /** Compact cards for the agent within a token budget. */
  contextFor(itemIds: readonly string[], tokenBudget: number): ItemCard[]
  /** Items whose stored vectors belong to another model than the active one (re-embed candidates). */
  staleEmbeddingItemIds(): string[]
  /** Refresh one item's vectors in memory from the database. */
  reloadItem(itemId: string): void
  /** Active embedding model, or null before `warm()` / without a provider. */
  activeModel(): string | null
  /** Query understanding (cues for the agent's evidence header). */
  parse(query: string, filters?: SearchFilters): ParsedQuery
}

const FTS_LIMIT = 40
const VECTOR_LIMIT = 40
const OR_FALLBACK_BELOW = 5
const QUERY_CACHE_SIZE = 64

/** Create the retrieval service. Call `warm()` after the embedding provider is ready. */
export function createRetrieval(deps: RetrievalDeps): RetrievalService {
  const { db, repos, embeddings, clock } = deps
  const logger = deps.logger.child({ scope: 'retrieval' })
  const index = new VectorIndex(embeddings?.dims ?? EMBEDDING_DIMS)
  const queryCache = new Map<string, Float32Array>()
  let warmed = false

  const toEntry = (row: EmbeddingRow): VectorEntry => ({
    itemId: row.itemId,
    chunkIndex: row.chunkIndex,
    role: row.role,
    vector: row.vector
  })

  const reloadItem = (itemId: string): void => {
    const model = index.model
    if (!model) return
    const rows = repos.embeddings.forItem(itemId).filter((r) => r.model === model)
    index.setItem(itemId, rows.map(toEntry))
  }

  const activeModel = (): string | null => (warmed && embeddings ? embeddings.model : index.model)

  const vectorReady = (): boolean => !!embeddings && warmed && index.model === embeddings.model && index.itemCount > 0

  async function embedQuery(text: string): Promise<Float32Array | null> {
    if (!embeddings) return null
    const key = `${embeddings.model}\u0000${text}`
    const cached = queryCache.get(key)
    if (cached) return cached
    const [vector] = await embeddings.embed([text])
    if (!vector) return null
    if (queryCache.size >= QUERY_CACHE_SIZE) {
      const oldest = queryCache.keys().next().value
      if (oldest !== undefined) queryCache.delete(oldest)
    }
    queryCache.set(key, vector)
    return vector
  }

  const loadItems = (ids: Iterable<string>): Map<string, Item> => {
    const list = [...new Set(ids)]
    const map = new Map<string, Item>()
    for (const item of repos.items.getMany(list)) map.set(item.id, item)
    return map
  }

  const runFts = (parsed: ParsedQuery, prefixLast: boolean): FtsHit[] => {
    const andMatch = buildMatch(parsed, { mode: 'and', prefixLast })
    if (!andMatch) return []
    const hits = ftsSearch(db, andMatch, FTS_LIMIT)
    if (hits.length >= OR_FALLBACK_BELOW || parsed.tokens.length + parsed.phrases.length < 2) return hits
    const orMatch = buildMatch(parsed, { mode: 'or', prefixLast })
    if (!orMatch || orMatch === andMatch) return hits
    const seen = new Set(hits.map((h) => h.itemId))
    const extra = ftsSearch(db, orMatch, FTS_LIMIT).filter((h) => !seen.has(h.itemId))
    // OR hits rank after every AND hit; their bm25Norm is scaled down so AND matches stay on top.
    return [...hits, ...extra.map((h) => ({ ...h, bm25Norm: h.bm25Norm * 0.6 }))]
  }

  async function vectorLeg(parsed: ParsedQuery, k: number, include?: ReadonlySet<string>): Promise<VectorHit[]> {
    if (!vectorReady() || parsed.embedText.trim().length === 0) return []
    const query = await embedQuery(parsed.embedText)
    if (!query) return []
    return index.search(query, k, include ? { include } : {})
  }

  /** Recent items matching the type/subtype/kind cue, for queries like "that pdf about attention". */
  const cueLeg = (parsed: ParsedQuery): string[] => {
    const { types, subtypes, kinds } = parsed.cues
    if (types.length + subtypes.length + kinds.length === 0) return []
    const clauses: string[] = []
    const params: string[] = []
    if (types.length > 0) {
      clauses.push(`type IN (${types.map(() => '?').join(', ')})`)
      params.push(...types)
    }
    if (subtypes.length > 0) {
      clauses.push(`subtype IN (${subtypes.map(() => '?').join(', ')})`)
      params.push(...subtypes)
    }
    if (kinds.length > 0) {
      clauses.push(`kind IN (${kinds.map(() => '?').join(', ')})`)
      params.push(...kinds)
    }
    const rows = db
      .prepare(
        `SELECT id FROM items WHERE deleted_at IS NULL AND parent_item_id IS NULL AND (${clauses.join(' OR ')})
         ORDER BY captured_at DESC LIMIT 20`
      )
      .all(...params) as Row[]
    return rows.map((r) => String(r.id))
  }

  const fallbackSnippet = (item: Item, parsed: ParsedQuery): string | undefined => {
    const source = item.understanding ?? item.excerpt ?? item.extractedText ?? null
    if (!source) return undefined
    const flat = source.replace(/\s+/g, ' ')
    const lower = flat.toLowerCase()
    for (const token of parsed.tokens) {
      const at = lower.indexOf(token)
      if (at === -1) continue
      const start = Math.max(0, at - 70)
      const end = Math.min(flat.length, at + token.length + 90)
      const prefix = start > 0 ? '…' : ''
      const suffix = end < flat.length ? '…' : ''
      const window = flat.slice(start, end)
      const rel = at - start
      return `${prefix}${window.slice(0, rel)}${SNIPPET_OPEN}${window.slice(rel, rel + token.length)}${SNIPPET_CLOSE}${window.slice(rel + token.length)}${suffix}`
    }
    return truncate(flat, 160)
  }

  const toHit = (item: Item, fused: FusedHit, parsed: ParsedQuery | null, nowIso: string): RetrievalHit => {
    const hit: RetrievalHit = {
      id: item.id,
      title: item.title,
      type: item.type,
      subtype: item.subtype,
      kind: item.kind,
      domain: item.domain,
      capturedAt: item.capturedAt,
      capturedAgo: relativeTime(item.capturedAt, nowIso),
      understanding: item.understanding ? truncate(item.understanding, 140) : null,
      thumbnailUrl: item.thumbnailPath ? toMediaUrl('thumbs', item.thumbnailPath, item.mediaVersion) : null,
      evidence: { matchedFields: fused.matchedFields },
      score: fused.score,
      reason: fused.reason
    }
    if (fused.bm25Norm !== undefined) hit.evidence.bm25Norm = Number(fused.bm25Norm.toFixed(3))
    if (fused.cosine !== undefined) hit.evidence.cosine = Number(fused.cosine.toFixed(3))
    const snippet = fused.snippet ?? (parsed ? fallbackSnippet(item, parsed) : undefined)
    if (snippet) hit.snippet = snippet
    return hit
  }

  async function hybrid(
    query: string,
    filters: SearchFilters,
    limit: number,
    opts: { prefixLast: boolean }
  ): Promise<RetrievalHit[]> {
    const now = clock.now()
    const parsed = parseQuery(query, now, filters)
    if (parsed.tokens.length === 0 && parsed.phrases.length === 0 && parsed.cueTokens.length === 0) return []
    const started = Date.now()
    const fts = runFts(parsed, opts.prefixLast)
    const vector = await vectorLeg(parsed, VECTOR_LIMIT)
    const cueCandidates = fts.length < OR_FALLBACK_BELOW ? cueLeg(parsed) : []
    const items = loadItems([...fts.map((h) => h.itemId), ...vector.map((h) => h.itemId), ...cueCandidates])
    const fused = fuse({ parsed, fts, vector, cueCandidates, items, now, limit })
    const nowIso = now.toISOString()
    const hits = fused.map((f) => toHit(items.get(f.itemId) as Item, f, parsed, nowIso))
    logger.debug('retrieval.search', {
      tokens: parsed.tokens,
      cues: parsed.cues,
      fts: fts.length,
      vector: vector.length,
      hits: hits.length,
      ms: Date.now() - started
    })
    return hits
  }

  const candidateFromVector = (item: Item, hit: VectorHit, nowIso: string): Candidate =>
    toHit(
      item,
      {
        itemId: item.id,
        score: hit.score,
        cosine: hit.cosine,
        matchedFields: [],
        reason: `similar meaning (${hit.cosine.toFixed(2)})`
      },
      null,
      nowIso
    )

  async function similarItems(itemId: string, k: number): Promise<Candidate[]> {
    const nowIso = clock.nowIso()
    const self = repos.items.get(itemId)
    if (!self) return []
    const vector = index.summaryVector(itemId)
    if (vector && vectorReady()) {
      const hits = index
        .search(vector, k + 5, { exclude: new Set([itemId]), summaryOnly: true })
        .filter((h) => h.cosine >= LIMITS.cosineFloor)
      const items = loadItems(hits.map((h) => h.itemId))
      return hits
        .map((h) => {
          const item = items.get(h.itemId)
          return item && !item.deletedAt ? candidateFromVector(item, h, nowIso) : null
        })
        .filter((c): c is Candidate => c !== null)
        .slice(0, k)
    }
    const match = buildBagMatch([self.title, ...self.topics, ...self.entities])
    if (!match) return []
    const fts = ftsSearch(db, match, k + 1).filter((h) => h.itemId !== itemId)
    const items = loadItems(fts.map((h) => h.itemId))
    const parsed = parseQuery(self.title, clock.now())
    return fuse({ parsed, fts, vector: [], items, now: clock.now(), limit: k }).map((f) =>
      toHit(items.get(f.itemId) as Item, f, null, nowIso)
    )
  }

  function collectionCandidates(itemId: string, k: number): Promise<CollectionCandidate[]> {
    const vector = index.summaryVector(itemId)
    if (!vector) return Promise.resolve([])
    const nowIso = clock.nowIso()
    const out: CollectionCandidate[] = []
    for (const summary of repos.collections.listSummaries()) {
      const memberIds = repos.collections
        .members(summary.id)
        .map((m) => m.itemId)
        .filter((id) => id !== itemId)
      const centroid = index.centroid(memberIds)
      if (!centroid) continue
      const cosine = dot(vector, centroid)
      const scored = memberIds
        .map((id) => ({ id, vec: index.summaryVector(id) }))
        .filter((m): m is { id: string; vec: Float32Array } => m.vec !== null)
        .map((m) => ({ id: m.id, cosine: dot(vector, m.vec) }))
        .sort((a, b) => b.cosine - a.cosine || (a.id < b.id ? -1 : 1))
        .slice(0, 3)
      const items = loadItems(scored.map((m) => m.id))
      const nearestMembers = scored
        .map((m) => {
          const item = items.get(m.id)
          return item
            ? candidateFromVector(
                item,
                { itemId: m.id, cosine: m.cosine, score: m.cosine, chunkIndex: 0, role: 'summary' },
                nowIso
              )
            : null
        })
        .filter((c): c is Candidate => c !== null)
      out.push({ collection: summary, cosine, nearestMembers })
    }
    out.sort((a, b) => b.cosine - a.cosine || (a.collection.id < b.collection.id ? -1 : 1))
    return Promise.resolve(out.slice(0, k))
  }

  async function indexItem(itemId: string): Promise<void> {
    const item = repos.items.get(itemId)
    if (!item || item.deletedAt) {
      index.removeItem(itemId)
      repos.items.syncFts(itemId)
      return
    }
    repos.items.syncFts(itemId)
    if (!embeddings) return
    const doc = memoryDocument(item)
    await embeddings.ready()
    const model = embeddings.model
    const existing = repos.embeddings.forItem(itemId).find((r) => r.chunkIndex === 0)
    if (existing && existing.model === model && existing.dims === embeddings.dims && existing.content === doc) {
      reloadItem(itemId)
      return
    }
    const [vector] = await embeddings.embed([doc])
    if (!vector) return
    db.transaction(() => {
      repos.embeddings.upsert([
        { itemId, chunkIndex: 0, role: 'summary', content: doc, vector, model, dims: embeddings.dims }
      ])
    })
    if (index.model !== model && warmed) index.load(model, repos.embeddings.allForModel(model).map(toEntry))
    else reloadItem(itemId)
  }

  async function embedBody(itemId: string): Promise<EmbedBodyResult> {
    const item = repos.items.get(itemId)
    if (!item || item.deletedAt || !embeddings) return { chunks: 0, model: null, skipped: true, unchanged: false }
    if (item.parentItemId) {
      const parent = repos.items.get(item.parentItemId)
      const files = parent?.metadata.folder?.fileCount ?? 0
      if (files > LIMITS.folderChildrenBodyEmbedLimit)
        return { chunks: 0, model: null, skipped: true, unchanged: false }
    }
    await embeddings.ready()
    const model = embeddings.model
    const chunks = bodyChunks(item.extractedText)
    const rows = repos.embeddings.forItem(itemId)
    const body = rows.filter((r) => r.chunkIndex >= 1)
    const unchanged =
      body.length === chunks.length &&
      body.every((r, i) => r.model === model && r.dims === embeddings.dims && r.content === chunks[i])
    if (unchanged) {
      reloadItem(itemId)
      return { chunks: chunks.length, model, skipped: false, unchanged: true }
    }
    const vectors = chunks.length > 0 ? await embeddings.embed(chunks) : []
    // An old-model summary is dropped here rather than carried; the index stage that follows rewrites chunk 0.
    const summary = rows.find((r) => r.chunkIndex === 0)
    const carriedSummary = summary && summary.model === model && summary.dims === embeddings.dims ? [summary] : []
    db.transaction(() => {
      repos.embeddings.replaceForItem(itemId, [
        ...carriedSummary,
        ...chunks.map((content, i) => ({
          itemId,
          chunkIndex: i + 1,
          role: 'body' as const,
          content,
          vector: vectors[i] as Float32Array,
          model,
          dims: embeddings.dims
        }))
      ])
    })
    reloadItem(itemId)
    return { chunks: chunks.length, model, skipped: false, unchanged: false }
  }

  const hourWindow = (capturedAt: string): [string, string] => {
    const t = Date.parse(capturedAt)
    return [new Date(t - 3_600_000).toISOString(), new Date(t + 3_600_000).toISOString()]
  }

  async function candidatesFor(itemId: string, opts: { k?: number } = {}): Promise<OrganizeCandidate[]> {
    const k = opts.k ?? 12
    const item = repos.items.get(itemId)
    if (!item) return []
    const nowIso = clock.nowIso()
    const info = new Map<string, { cosine?: number; flags: Set<string>; fts?: boolean }>()
    const touch = (id: string): { cosine?: number; flags: Set<string>; fts?: boolean } => {
      if (id === itemId) return { flags: new Set() }
      let entry = info.get(id)
      if (!entry) {
        entry = { flags: new Set() }
        info.set(id, entry)
      }
      return entry
    }

    const vector = index.summaryVector(itemId)
    if (vector && vectorReady()) {
      for (const hit of index.search(vector, k, { exclude: new Set([itemId]), summaryOnly: true })) {
        if (hit.cosine < LIMITS.cosineFloor) continue
        touch(hit.itemId).cosine = hit.cosine
      }
    }
    const bag = buildBagMatch([item.title, ...item.topics, ...item.entities])
    if (bag) for (const hit of ftsSearch(db, bag, 11)) if (hit.itemId !== itemId) touch(hit.itemId).fts = true

    if (item.domain) {
      const rows = db
        .prepare(
          'SELECT id FROM items WHERE domain = ? AND id != ? AND deleted_at IS NULL ORDER BY captured_at DESC LIMIT 10'
        )
        .all(item.domain, itemId) as Row[]
      for (const row of rows) touch(String(row.id)).flags.add('same_domain')
    }
    const owner = item.metadata.repo?.owner
    if (owner) {
      const rows = db
        .prepare(
          "SELECT id FROM items WHERE id != ? AND deleted_at IS NULL AND json_extract(metadata, '$.repo.owner') = ? LIMIT 10"
        )
        .all(itemId, owner) as Row[]
      for (const row of rows) touch(String(row.id)).flags.add('same_owner')
    }
    if (item.parentItemId) {
      for (const sibling of repos.items.children(item.parentItemId).slice(0, 20)) {
        if (sibling.id !== itemId) touch(sibling.id).flags.add('same_folder')
      }
    }
    if (item.captureBatchId) {
      for (const sibling of repos.items.siblings(item.captureBatchId)) {
        if (sibling.id !== itemId) touch(sibling.id).flags.add('same_batch')
      }
    }
    const [from, to] = hourWindow(item.capturedAt)
    const nearby = db
      .prepare(
        'SELECT id FROM items WHERE id != ? AND deleted_at IS NULL AND parent_item_id IS NULL AND captured_at BETWEEN ? AND ? LIMIT 10'
      )
      .all(itemId, from, to) as Row[]
    for (const row of nearby) touch(String(row.id)).flags.add('same_hour')

    for (const view of repos.relationships.forItem(itemId)) {
      const other = view.sourceItemId === itemId ? view.targetItemId : view.sourceItemId
      touch(other).flags.add(view.createdBy === 'user' ? 'user_related' : 'already_related')
    }

    const items = loadItems(info.keys())
    const topics = new Set(item.topics.map((t) => t.toLowerCase()))
    const entities = new Set(item.entities.map((e) => e.toLowerCase()))
    const candidates: (OrganizeCandidate & { rank: number })[] = []
    for (const [id, entry] of info) {
      const other = items.get(id)
      if (!other || other.deletedAt) continue
      const sharedTopics = other.topics.filter((t) => topics.has(t.toLowerCase()))
      const sharedEntities = other.entities.filter((e) => entities.has(e.toLowerCase()))
      const rank =
        (entry.cosine ?? 0) +
        (entry.fts ? 0.15 : 0) +
        sharedEntities.length * 0.1 +
        sharedTopics.length * 0.05 +
        (entry.flags.size > 0 ? 0.1 : 0)
      const candidate: OrganizeCandidate & { rank: number } = {
        id,
        title: other.title,
        type: other.subtype ? `${other.type}/${other.subtype}` : other.type,
        kind: other.kind,
        domain: other.domain,
        capturedAgo: relativeTime(other.capturedAt, nowIso),
        topics: other.topics.slice(0, 4),
        understanding: other.understanding ? truncate(other.understanding, 140) : null,
        sharedTopics,
        sharedEntities,
        flags: [...entry.flags].sort(),
        rank
      }
      if (entry.cosine !== undefined) candidate.cosine = Number(entry.cosine.toFixed(2))
      candidates.push(candidate)
    }
    candidates.sort((a, b) => b.rank - a.rank || (a.id < b.id ? -1 : 1))
    return candidates.slice(0, k + 6).map(({ rank: _rank, ...rest }) => rest)
  }

  return {
    quickSearch: (query, opts = {}) => hybrid(query, {}, opts.limit ?? 20, { prefixLast: true }),
    search: (query, filters, k) => hybrid(query, filters, k, { prefixLast: false }),
    async semantic(query, k, filters = {}) {
      const now = clock.now()
      const parsed = parseQuery(query, now, filters)
      const vector = await vectorLeg(parsed, Math.max(k * 3, 20))
      const items = loadItems(vector.map((h) => h.itemId))
      const fused = fuse({ parsed, fts: [], vector, items, now, limit: k, vectorWeight: 1 })
      const nowIso = now.toISOString()
      return fused.map((f) => toHit(items.get(f.itemId) as Item, f, parsed, nowIso))
    },
    similarItems,
    indexItem,
    async removeItem(itemId) {
      index.removeItem(itemId)
      repos.items.syncFts(itemId)
    },
    embedTexts: async (texts) => (embeddings ? embeddings.embed(texts) : []),
    collectionCandidates,
    async warm() {
      if (embeddings) {
        await embeddings.ready()
        const model = embeddings.model
        const rows = repos.embeddings.allForModel(model)
        index.load(model, rows.map(toEntry))
      }
      warmed = true
      const stale = embeddings ? staleEmbeddingItemIds().length : 0
      logger.info('retrieval.warm', {
        model: embeddings?.model ?? null,
        backend: embeddings?.id ?? 'none',
        vectors: index.size,
        items: index.itemCount,
        staleItems: stale
      })
    },
    embedBody,
    candidatesFor,
    contextFor(itemIds, tokenBudget) {
      const items = repos.items.getMany(itemIds).filter((i) => !i.deletedAt)
      return contextCards(items, tokenBudget, { nowIso: clock.nowIso() })
    },
    staleEmbeddingItemIds,
    reloadItem,
    activeModel,
    parse: (query, filters = {}) => parseQuery(query, clock.now(), filters)
  }

  // Rows from another model or with a wrong `dims` (a bad build once wrote 0) are both re-embedded.
  function staleEmbeddingItemIds(): string[] {
    const model = embeddings?.model
    if (!model) return []
    const rows = db
      .prepare(
        `SELECT DISTINCT e.item_id AS id FROM embeddings e JOIN items i ON i.id = e.item_id
         WHERE (e.model != ? OR e.dims != ?) AND i.deleted_at IS NULL ORDER BY e.item_id`
      )
      .all(model, embeddings.dims) as Row[]
    return rows.map((r) => String(r.id))
  }
}
