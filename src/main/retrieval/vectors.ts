/**
 * In-memory vector matrix: normalised `Float32Array`s loaded from
 * the `embeddings` table for one model, dot products per query, max-pooled per item with role
 * weights (summary 1.0, body 0.8). Sub-10 ms at 15k × 384 on a laptop; no native deps.
 */

import type { EmbeddingRole } from '../../shared/types'

export interface VectorEntry {
  itemId: string
  chunkIndex: number
  role: EmbeddingRole
  vector: Float32Array
}

/** One vector hit, max-pooled per item. */
export interface VectorHit {
  itemId: string
  /** Best raw cosine among the item's chunks (before role weighting). */
  cosine: number
  /** Role-weighted score used for ranking. */
  score: number
  chunkIndex: number
  role: EmbeddingRole
}

export interface VectorSearchOptions {
  exclude?: ReadonlySet<string>
  /** Only consider these items (filters). */
  include?: ReadonlySet<string>
  /** Only chunk 0 (item-to-item candidates). */
  summaryOnly?: boolean
  roleWeights?: Partial<Record<EmbeddingRole, number>>
}

const DEFAULT_ROLE_WEIGHTS: Record<EmbeddingRole, number> = { summary: 1, body: 0.8 }

/** Dot product of two normalised vectors. */
export function dot(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length)
  let sum = 0
  for (let i = 0; i < n; i++) sum += (a[i] as number) * (b[i] as number)
  return sum
}

/** Mean of vectors, re-normalised; null when empty. */
export function centroidOf(vectors: readonly Float32Array[], dims: number): Float32Array | null {
  if (vectors.length === 0) return null
  const out = new Float32Array(dims)
  for (const v of vectors) for (let i = 0; i < dims; i++) out[i] = (out[i] as number) + (v[i] ?? 0)
  let norm = 0
  for (let i = 0; i < dims; i++) norm += (out[i] as number) ** 2
  norm = Math.sqrt(norm)
  if (norm === 0) return null
  for (let i = 0; i < dims; i++) out[i] = (out[i] as number) / norm
  return out
}

/** The matrix. Holds vectors of exactly one embedding model at a time. */
export class VectorIndex {
  readonly dims: number
  private entries: VectorEntry[] = []
  private byItem = new Map<string, VectorEntry[]>()
  private modelId: string | null = null

  constructor(dims: number) {
    this.dims = dims
  }

  /** Model whose vectors are loaded, or null when empty. */
  get model(): string | null {
    return this.modelId
  }

  get size(): number {
    return this.entries.length
  }

  get itemCount(): number {
    return this.byItem.size
  }

  /** Replace everything with `rows` (already filtered to one model). */
  load(model: string, rows: readonly VectorEntry[]): void {
    this.modelId = model
    this.entries = []
    this.byItem = new Map()
    for (const row of rows) this.push(row)
  }

  setItem(itemId: string, rows: readonly VectorEntry[]): void {
    this.removeItem(itemId)
    for (const row of rows) if (row.itemId === itemId) this.push(row)
  }

  removeItem(itemId: string): void {
    if (!this.byItem.has(itemId)) return
    this.byItem.delete(itemId)
    this.entries = this.entries.filter((e) => e.itemId !== itemId)
  }

  has(itemId: string): boolean {
    return this.byItem.has(itemId)
  }

  /** Chunk 0 vector of an item, or null. */
  summaryVector(itemId: string): Float32Array | null {
    return this.byItem.get(itemId)?.find((e) => e.chunkIndex === 0)?.vector ?? null
  }

  /** Centroid of the items' summary vectors (items without one are skipped). */
  centroid(itemIds: readonly string[]): Float32Array | null {
    const vectors: Float32Array[] = []
    for (const id of itemIds) {
      const v = this.summaryVector(id)
      if (v) vectors.push(v)
    }
    return centroidOf(vectors, this.dims)
  }

  /** Nearest items to `query`, max-pooled per item, sorted by weighted score (ties: itemId). */
  search(query: Float32Array, k: number, opts: VectorSearchOptions = {}): VectorHit[] {
    const weights = { ...DEFAULT_ROLE_WEIGHTS, ...(opts.roleWeights ?? {}) }
    const best = new Map<string, VectorHit>()
    for (const entry of this.entries) {
      if (opts.summaryOnly && entry.chunkIndex !== 0) continue
      if (opts.exclude?.has(entry.itemId)) continue
      if (opts.include && !opts.include.has(entry.itemId)) continue
      const cosine = dot(query, entry.vector)
      const score = cosine * weights[entry.role]
      const current = best.get(entry.itemId)
      if (!current || score > current.score) {
        best.set(entry.itemId, { itemId: entry.itemId, cosine, score, chunkIndex: entry.chunkIndex, role: entry.role })
      }
    }
    return [...best.values()]
      .sort((a, b) => b.score - a.score || (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0))
      .slice(0, Math.max(0, k))
  }

  private push(row: VectorEntry): void {
    if (row.vector.length === 0) return
    this.entries.push(row)
    const list = this.byItem.get(row.itemId)
    if (list) list.push(row)
    else this.byItem.set(row.itemId, [row])
  }
}
