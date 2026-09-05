import { EMBEDDING_DIMS } from '../../../shared/constants'
import type { EmbeddingProvider } from '../../ports'

export const HASH_EMBEDDING_ID = 'local-hash'
/** Model id stored in `embeddings.model`. */
export const HASH_EMBEDDING_MODEL = 'local-hash-v1'

const STOPWORDS = new Set(
  'a an the and or of to in on at by for with from as is are was were be it this that these those you your we our they their i my'.split(
    ' '
  )
)

export function fnv1a(text: string, seed = 0x811c9dc5): number {
  let hash = seed >>> 0
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/** Lower-cased alphanumeric tokens ≥ 2 chars minus stopwords. */
export function tokenize(text: string): string[] {
  const out: string[] = []
  for (const raw of text
    .toLowerCase()
    .normalize('NFKD')
    .split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || STOPWORDS.has(raw)) continue
    out.push(raw)
  }
  return out
}

/**
 * Embed one text: unigrams (weight 1) and bigrams (weight 0.5) hashed into `dims` buckets with a
 * hash-derived sign, sublinear term frequency, L2-normalized. Empty text -> zero vector.
 */
export function hashEmbed(text: string, dims: number = EMBEDDING_DIMS): Float32Array {
  const vector = new Float32Array(dims)
  const tokens = tokenize(text)
  if (tokens.length === 0) return vector
  const counts = new Map<string, number>()
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as string
    counts.set(token, (counts.get(token) ?? 0) + 1)
    const next = tokens[i + 1]
    if (next !== undefined) {
      const bigram = `${token}_${next}`
      counts.set(bigram, (counts.get(bigram) ?? 0) + 0.5)
    }
  }
  for (const [term, count] of counts) {
    const hash = fnv1a(term)
    const index = hash % dims
    const sign = fnv1a(term, 0x9747b28c) & 1 ? 1 : -1
    vector[index] = (vector[index] ?? 0) + sign * (1 + Math.log(count))
  }
  let norm = 0
  for (let i = 0; i < dims; i++) norm += (vector[i] ?? 0) ** 2
  norm = Math.sqrt(norm)
  if (norm > 0) for (let i = 0; i < dims; i++) vector[i] = (vector[i] ?? 0) / norm
  return vector
}

export function createHashEmbeddingProvider(dims: number = EMBEDDING_DIMS): EmbeddingProvider {
  return {
    id: HASH_EMBEDDING_ID,
    model: HASH_EMBEDDING_MODEL,
    dims,
    embed: async (texts) => texts.map((text) => hashEmbed(text, dims)),
    ready: async () => true
  }
}
