/**
 * Fusion of the FTS and vector legs: weighted reciprocal-rank fusion,
 * a cosine floor for vector-only entries, top-tier boosts for exact title/domain/entity matches,
 * a plateau boost inside a time window, mild recency when no time cue was given, soft type cues
 * (hard when `strict`), note exclusion without a note cue and folder-children collapsing.
 */

import { LIMITS } from '../../shared/constants'
import { normalizeName, tokenize } from '../../shared/text'
import type { Item } from '../../shared/types'
import type { FtsHit } from './fts'
import type { ParsedQuery, QueryCues } from './query'
import type { VectorHit } from './vectors'

export const RRF_K = 60

/** A fused hit with the evidence that produced it. */
export interface FusedHit {
  itemId: string
  score: number
  bm25Norm?: number
  cosine?: number
  matchedFields: string[]
  snippet?: string
  /** Short product-voice explanation ("Matches title, topics · similar meaning"). */
  reason: string
}

export interface FuseInput {
  parsed: ParsedQuery
  fts: readonly FtsHit[]
  vector: readonly VectorHit[]
  /** Items that match the type cue but neither leg found (recent first); a weak third leg. */
  cueCandidates?: readonly string[]
  /** Items behind every hit id (hits whose item is missing or trashed are dropped). */
  items: ReadonlyMap<string, Item>
  now: Date
  limit: number
  /** Weight of the FTS leg (default: 1.0). */
  ftsWeight?: number
  /** Weight of the vector leg (default: 0.4 for ≤ 2 content tokens, 1.0 otherwise). */
  vectorWeight?: number
  cosineFloor?: number
  /** Weight of the cue-candidate leg (default 0.3). */
  cueWeight?: number
  /** Max children shown per folder (default 3). */
  childrenPerFolder?: number
}

const DAY_MS = 86_400_000

/** Vector-leg weight by query length (short keyword queries trust FTS more). */
export function defaultVectorWeight(parsed: ParsedQuery): number {
  return parsed.tokens.length + parsed.phrases.length <= 2 ? 0.4 : 1
}

export function matchesTypeCue(item: Pick<Item, 'type' | 'subtype' | 'kind'>, cues: QueryCues): boolean {
  if (cues.types.length === 0 && cues.subtypes.length === 0 && cues.kinds.length === 0) return false
  return (
    cues.types.includes(item.type) ||
    (item.subtype !== null && cues.subtypes.includes(item.subtype)) ||
    (item.kind !== null && cues.kinds.includes(item.kind))
  )
}

/** Plateau ×1.5 inside the window, decaying to ×1.0 over a margin as long as the window itself. */
export function timeBoost(capturedAt: string, cue: { since?: string; until?: string }, now: Date): number {
  const t = Date.parse(capturedAt)
  if (!Number.isFinite(t)) return 1
  const since = cue.since ? Date.parse(cue.since) : Number.NEGATIVE_INFINITY
  const until = cue.until ? Date.parse(cue.until) : now.getTime()
  if (t >= since && t <= until) return 1.5
  const span = Number.isFinite(since) ? Math.max(until - since, DAY_MS) : 14 * DAY_MS
  const distance = t < since ? since - t : t - until
  const factor = Math.max(0, 1 - distance / span)
  return 1 + 0.5 * factor
}

/** Mild recency when no time cue: ×(1 + 0.25·e^(−ageDays/60)). */
export function recencyBoost(capturedAt: string, now: Date): number {
  const t = Date.parse(capturedAt)
  if (!Number.isFinite(t)) return 1
  const ageDays = Math.max(0, (now.getTime() - t) / DAY_MS)
  return 1 + 0.25 * Math.exp(-ageDays / 60)
}

function exactMatchBoost(item: Item, parsed: ParsedQuery): { factor: number; why: string | null } {
  const tokens = parsed.tokens
  if (tokens.length === 0) return { factor: 1, why: null }
  const query = tokens.join(' ')
  const title = normalizeName(item.title)
  if (title === query) return { factor: 1.5, why: 'exact title' }
  const titleTokens = new Set(tokenize(item.title))
  if (tokens.every((t) => titleTokens.has(t))) return { factor: 1.3, why: 'title' }
  if (item.domain) {
    const host = item.domain.toLowerCase().replace(/^www\./, '')
    const label = host.split('.')[0] ?? host
    if (tokens.some((t) => t === host || t === label)) return { factor: 1.3, why: 'domain' }
  }
  const entities = new Set(item.entities.map((e) => normalizeName(e)))
  if (tokens.some((t) => entities.has(t)) || entities.has(query)) return { factor: 1.2, why: 'entity' }
  return { factor: 1, why: null }
}

function fieldLabel(field: string): string {
  switch (field) {
    case 'retrieval_hints':
      return 'memory cues'
    case 'why_useful':
      return 'why it was kept'
    case 'vision_text':
      return 'what the image shows'
    case 'meta_text':
      return 'page details'
    case 'extracted_text':
      return 'content'
    default:
      return field
  }
}

export function fuse(input: FuseInput): FusedHit[] {
  const { parsed, items, now } = input
  const cues = parsed.cues
  const ftsWeight = input.ftsWeight ?? 1
  const vectorWeight = input.vectorWeight ?? defaultVectorWeight(parsed)
  const floor = input.cosineFloor ?? LIMITS.cosineFloor
  const hasTypeCue = cues.types.length > 0 || cues.subtypes.length > 0 || cues.kinds.length > 0

  const ftsRank = new Map<string, { rank: number; hit: FtsHit }>()
  input.fts.forEach((hit, i) => {
    if (!ftsRank.has(hit.itemId)) ftsRank.set(hit.itemId, { rank: i + 1, hit })
  })
  const vecRank = new Map<string, { rank: number; hit: VectorHit }>()
  input.vector.forEach((hit, i) => {
    if (!vecRank.has(hit.itemId)) vecRank.set(hit.itemId, { rank: i + 1, hit })
  })

  const cueRank = new Map<string, number>()
  ;(input.cueCandidates ?? []).forEach((id, i) => {
    if (!cueRank.has(id)) cueRank.set(id, i + 1)
  })
  const cueWeight = input.cueWeight ?? 0.3
  const ids = new Set<string>([...ftsRank.keys(), ...vecRank.keys(), ...cueRank.keys()])
  const fused: (FusedHit & { capturedAt: string; parentItemId: string | null })[] = []
  for (const id of ids) {
    const item = items.get(id)
    if (!item || item.deletedAt) continue
    if (item.type === 'note' && !cues.noteCue && !cues.types.includes('note')) continue
    const f = ftsRank.get(id)
    const c = cueRank.get(id)
    const vec = vecRank.get(id)
    // Vector-only hits below the floor are dropped unless the type cue brought the item in; a weak
    // vector still contributes when FTS matched too (RRF is rank-based).
    const weakOnly = !f && vec !== undefined && vec.hit.cosine < floor
    const v = weakOnly ? undefined : vec
    if (!f && !v && c === undefined) continue
    if (cues.domains.length > 0) {
      const host = (item.domain ?? '').toLowerCase().replace(/^www\./, '')
      if (!cues.domains.some((d) => host === d || host.endsWith(`.${d}`))) continue
    }
    const typeMatch = matchesTypeCue(item, cues)
    if (hasTypeCue && cues.strict && !typeMatch) continue
    if (cues.strict && cues.timeframe && timeBoost(item.capturedAt, cues.timeframe, now) < 1.5) continue

    let score = 0
    const why: string[] = []
    if (f) {
      score += ftsWeight / (RRF_K + f.rank)
      if (f.hit.matchedFields.length > 0)
        why.push(`Matches ${f.hit.matchedFields.slice(0, 3).map(fieldLabel).join(', ')}`)
    }
    if (v) {
      score += vectorWeight / (RRF_K + v.rank)
      why.push(`similar meaning (${v.hit.cosine.toFixed(2)})`)
    }
    if (c !== undefined && !f && !v) {
      // Cue-only candidates: rank by the cue leg, nudged by whatever similarity exists.
      score += (cueWeight / (RRF_K + c)) * (1 + Math.max(0, vec?.hit.cosine ?? 0))
      if (vec) why.push(`similar meaning (${vec.hit.cosine.toFixed(2)})`)
    }
    const exact = exactMatchBoost(item, parsed)
    score *= exact.factor
    if (exact.why) why.unshift(`Exact ${exact.why} match`)
    if (hasTypeCue && typeMatch) {
      score *= 1.35
      why.push(`the kind of thing you asked for`)
    }
    if (cues.timeframe) {
      const boost = timeBoost(item.capturedAt, cues.timeframe, now)
      score *= boost
      if (boost >= 1.5) why.push(`kept ${cues.timeframe.label}`)
    } else {
      score *= recencyBoost(item.capturedAt, now)
    }

    const hit: FusedHit & { capturedAt: string; parentItemId: string | null } = {
      itemId: id,
      score,
      matchedFields: f?.hit.matchedFields ?? [],
      reason: why.join(' · ') || 'Related to your search',
      capturedAt: item.capturedAt,
      parentItemId: item.parentItemId
    }
    if (f) hit.bm25Norm = f.hit.bm25Norm
    if (v) hit.cosine = v.hit.cosine
    const snippet = f?.hit.snippet
    if (snippet && snippet.length > 0) hit.snippet = snippet
    fused.push(hit)
  }

  fused.sort(
    (a, b) =>
      b.score - a.score ||
      (a.capturedAt < b.capturedAt ? 1 : a.capturedAt > b.capturedAt ? -1 : 0) ||
      (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0)
  )

  // Collapse folder children: at most N per parent.
  const perParent = new Map<string, number>()
  const limitPerFolder = input.childrenPerFolder ?? 3
  const out: FusedHit[] = []
  for (const hit of fused) {
    if (hit.parentItemId) {
      const n = perParent.get(hit.parentItemId) ?? 0
      if (n >= limitPerFolder) continue
      perParent.set(hit.parentItemId, n + 1)
    }
    const { capturedAt: _c, parentItemId: _p, ...rest } = hit
    out.push(rest)
    if (out.length >= input.limit) break
  }
  return out
}
