import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHashEmbeddingProvider } from '../../src/main/ai'
import { silentLogger } from '../../src/main/lib/logger'
import {
  bodyChunks,
  createRetrieval,
  memoryDocument,
  type RetrievalService,
  SNIPPET_OPEN
} from '../../src/main/retrieval'
import { createHarness, type Harness } from './helpers/harness'

let h: Harness
let retrieval: RetrievalService

const DAY = 86_400_000

async function seed(): Promise<Record<string, string>> {
  const now = h.clock.now().getTime()
  const ago = (days: number): string => new Date(now - days * DAY).toISOString()
  const ids: Record<string, string> = {}
  const make = (key: string, input: Parameters<Harness['item']>[0]): void => {
    ids[key] = h.item({ processingStatus: 'READY', ...input }).id
  }
  make('vllm', {
    type: 'url',
    subtype: 'github_repo',
    kind: 'library',
    title: 'vllm-project/vllm',
    domain: 'github.com',
    understanding: 'High-throughput LLM serving engine built around PagedAttention for KV-cache memory management.',
    topics: ['llm serving', 'inference engine'],
    entities: ['vLLM', 'PagedAttention'],
    retrievalHints: ['vllm repo', 'fast inference server'],
    capturedAt: ago(21)
  })
  make('paged', {
    type: 'pdf',
    kind: 'paper',
    title: 'Efficient Memory Management for LLM Serving with PagedAttention',
    understanding: 'Research paper introducing PagedAttention, the attention algorithm behind vLLM.',
    topics: ['llm serving', 'kv cache'],
    entities: ['vLLM', 'PagedAttention'],
    extractedText:
      'Abstract. We present PagedAttention, an attention algorithm inspired by virtual memory and paging in operating systems.',
    capturedAt: ago(21)
  })
  make('raycast', {
    type: 'url',
    subtype: 'product',
    kind: 'macos_app',
    title: 'Raycast — launcher for macOS',
    domain: 'raycast.com',
    understanding:
      'Product page of Raycast, a keyboard-driven launcher for the Mac with extensions and window management.',
    topics: ['macos apps', 'productivity'],
    entities: ['Raycast'],
    retrievalHints: ['mac launcher app', 'spotlight replacement'],
    capturedAt: ago(18)
  })
  make('hyper', {
    type: 'text',
    kind: 'note',
    title: 'Hyperliquid — notes on on-chain perps',
    understanding:
      'Personal notes on how Hyperliquid runs a perpetuals exchange on its own L1 with HyperBFT consensus.',
    topics: ['crypto exchanges'],
    entities: ['Hyperliquid', 'HyperBFT'],
    extractedText: 'Hyperliquid runs an order book on chain. HyperBFT reaches consensus in under a second.',
    excerpt: 'Hyperliquid runs an order book on chain.',
    capturedAt: ago(30)
  })
  make('note', {
    type: 'note',
    kind: 'note',
    title: 'Comparison note: inference providers',
    understanding: 'Generated note comparing cheap inference providers.',
    topics: ['inference pricing'],
    extractedText: 'GMI Cloud and Together AI pricing compared for MiniMax inference.',
    capturedAt: ago(1)
  })
  make('pricing', {
    type: 'image',
    subtype: 'screenshot',
    kind: 'screenshot',
    title: 'NimbusServe serverless inference pricing page',
    understanding: 'Screenshot of a pricing table for serverless LLM inference with per-million-token prices.',
    visionText: 'Llama 3.3 70B $0.27 / 1M tokens. DeepSeek V3.1 $0.40 / 1M tokens.',
    topics: ['inference pricing'],
    capturedAt: ago(8)
  })
  for (const id of Object.values(ids)) await retrieval.indexItem(id)
  return ids
}

beforeEach(async () => {
  h = createHarness()
  retrieval = createRetrieval({
    db: h.db,
    repos: h.repos,
    embeddings: createHashEmbeddingProvider(),
    logger: silentLogger,
    clock: h.clock
  })
  await retrieval.warm()
})
afterEach(() => h.close())

describe('retrieval', () => {
  it('ranks exact keyword hits first with highlighted snippets and evidence', async () => {
    const ids = await seed()
    const hits = await retrieval.quickSearch('hyperliquid')
    expect(hits[0]?.id).toBe(ids.hyper)
    expect(hits[0]?.evidence.matchedFields).toContain('title')
    expect(hits[0]?.evidence.bm25Norm).toBe(1)
    expect(hits[0]?.snippet).toContain(SNIPPET_OPEN)
    expect((hits[0] as { reason?: string }).reason).toMatch(/title/i)
  })

  it('fuses FTS and vector legs and puts the two vLLM items on top for "vllm"', async () => {
    const ids = await seed()
    const hits = await retrieval.quickSearch('vllm', { limit: 3 })
    expect(
      hits
        .slice(0, 2)
        .map((h) => h.id)
        .sort()
    ).toEqual([ids.paged, ids.vllm].sort())
    for (const hit of hits)
      expect(hit.evidence.matchedFields.length > 0 || hit.evidence.cosine !== undefined).toBe(true)
  })

  it('treats type cues as soft boosts and hard filters when strict', async () => {
    const ids = await seed()
    const soft = await retrieval.quickSearch('that pdf about attention')
    expect(soft[0]?.id).toBe(ids.paged)
    const strict = await retrieval.search('attention', { types: ['url'], strict: true }, 5)
    expect(strict.every((h) => h.type === 'url')).toBe(true)
  })

  it('excludes generated notes unless the person asks for notes', async () => {
    const ids = await seed()
    const without = await retrieval.quickSearch('inference pricing')
    expect(without.map((h) => h.id)).not.toContain(ids.note)
    expect(without[0]?.id).toBe(ids.pricing)
    const withCue = await retrieval.quickSearch('my notes on inference pricing')
    expect(withCue.map((h) => h.id)).toContain(ids.note)
  })

  it('boosts items inside a time window and the asked-for kind ("mac app a few weeks ago")', async () => {
    const ids = await seed()
    const hits = await retrieval.quickSearch('that mac app I saved a few weeks ago')
    expect(hits[0]?.id).toBe(ids.raycast)
    expect((hits[0] as { reason?: string }).reason).toMatch(/a few weeks ago/)
  })

  it('returns nothing for stopword-only queries and is deterministic', async () => {
    await seed()
    expect(await retrieval.quickSearch('the of')).toEqual([])
    const a = (await retrieval.quickSearch('llm serving')).map((h) => h.id)
    const b = (await retrieval.quickSearch('llm serving')).map((h) => h.id)
    expect(a).toEqual(b)
    expect(a.length).toBeGreaterThan(0)
  })

  it('finds similar items by summary vector and collection candidates by centroid', async () => {
    const ids = await seed()
    const similar = await retrieval.similarItems(ids.vllm as string, 3)
    expect(similar.map((c) => c.id)).toContain(ids.paged)
    expect(similar.every((c) => c.id !== ids.vllm)).toBe(true)
    const collection = h.collections.create({ name: 'LLM serving research', createdBy: 'user' })
    h.collections.addItems(collection.id, [{ itemId: ids.paged as string }], { actor: 'user' })
    const candidates = await retrieval.collectionCandidates(ids.vllm as string, 3)
    expect(candidates[0]?.collection.id).toBe(collection.id)
    expect(candidates[0]?.cosine).toBeGreaterThan(0)
    expect(candidates[0]?.nearestMembers.map((m) => m.id)).toEqual([ids.paged])
  })

  it('builds thin organize candidates with cosine, shared entities and deterministic flags', async () => {
    const ids = await seed()
    h.repos.items.update(ids.paged as string, { domain: 'github.com' })
    const candidates = await retrieval.candidatesFor(ids.vllm as string, { k: 5 })
    const paged = candidates.find((c) => c.id === ids.paged)
    expect(paged).toBeDefined()
    expect(paged?.sharedEntities).toEqual(['vLLM', 'PagedAttention'])
    expect(paged?.flags).toContain('same_domain')
    expect(paged?.cosine).toBeGreaterThan(0)
    expect(candidates.some((c) => c.id === ids.vllm)).toBe(false)
  })

  it('embeds body chunks idempotently and re-indexes on change', async () => {
    const ids = await seed()
    const first = await retrieval.embedBody(ids.hyper as string)
    expect(first).toMatchObject({ chunks: 1, skipped: false, unchanged: false, model: 'local-hash-v1' })
    const second = await retrieval.embedBody(ids.hyper as string)
    expect(second.unchanged).toBe(true)
    expect(h.repos.embeddings.forItem(ids.hyper as string).map((r) => r.chunkIndex)).toEqual([0, 1])
    h.repos.items.update(ids.hyper as string, { extractedText: 'Completely new text about something else entirely.' })
    const third = await retrieval.embedBody(ids.hyper as string)
    expect(third.unchanged).toBe(false)
    const indexed = h.repos.embeddings.forItem(ids.hyper as string)
    expect(indexed.find((r) => r.chunkIndex === 1)?.content).toMatch(/Completely new/)
    expect(indexed.find((r) => r.chunkIndex === 0)?.content).toBe(
      memoryDocument(h.repos.items.get(ids.hyper as string)!)
    )
  })

  it('reports vectors from another model as stale and drops removed items', async () => {
    const ids = await seed()
    h.repos.embeddings.upsert([
      {
        itemId: ids.raycast as string,
        chunkIndex: 5,
        role: 'body',
        content: 'old',
        vector: new Float32Array(384),
        model: 'Xenova/all-MiniLM-L6-v2',
        dims: 384
      }
    ])
    expect(retrieval.staleEmbeddingItemIds()).toEqual([ids.raycast])
    await retrieval.removeItem(ids.raycast as string)
    const hits = await retrieval.quickSearch('raycast')
    expect(hits.map((x) => x.id)).toContain(ids.raycast) // FTS row still there: item is not deleted
    h.items.trash([ids.raycast as string])
    await retrieval.removeItem(ids.raycast as string)
    expect(await retrieval.quickSearch('raycast')).toEqual([])
  })

  it('assembles agent context cards within a token budget', async () => {
    const ids = await seed()
    const cards = retrieval.contextFor([ids.vllm as string, ids.paged as string, ids.raycast as string], 10_000)
    expect(cards.map((c) => c.id)).toEqual([ids.vllm, ids.paged, ids.raycast])
    expect(cards[0]).toMatchObject({ type: 'url/github_repo', kind: 'library', domain: 'github.com' })
    const tight = retrieval.contextFor([ids.vllm as string, ids.paged as string], 10)
    expect(tight).toHaveLength(1)
  })
})

describe('bodyChunks', () => {
  it('splits on paragraph boundaries and caps the number of chunks', () => {
    const text = Array.from({ length: 60 }, (_, i) => `Paragraph ${i} `.repeat(30)).join('\n\n')
    const chunks = bodyChunks(text)
    expect(chunks.length).toBe(24)
    expect(chunks.every((c) => c.length <= 900)).toBe(true)
    expect(bodyChunks('   ')).toEqual([])
    expect(bodyChunks(null)).toEqual([])
  })
})
