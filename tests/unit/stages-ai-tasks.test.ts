import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetConsolidateCounter } from '../../src/main/agent/tasks/organize'
import {
  createHashEmbeddingProvider,
  createOffProvider,
  createScriptedProvider,
  jsonResponse,
  type ScriptedProvider,
  textResponse
} from '../../src/main/ai'
import { isKaError } from '../../src/main/core/errors'
import { silentLogger } from '../../src/main/lib/logger'
import { STAGES, stageByName } from '../../src/main/pipeline/stages'
import type { AIProvider, StageContext, StagePatch } from '../../src/main/ports'
import { createRetrieval, type RetrievalService } from '../../src/main/retrieval'
import type { Item, Stage, Understanding } from '../../src/shared/types'
import { createHarness, type Harness } from './helpers/harness'

let h: Harness
let retrieval: RetrievalService

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
  resetConsolidateCounter()
})
afterEach(() => h.close())

function ctx(ai: AIProvider, opts: { itemId?: string; batchId?: string } = {}): StageContext {
  const item = opts.itemId ? (h.repos.items.get(opts.itemId) ?? undefined) : undefined
  return {
    ...(opts.itemId ? { itemId: opts.itemId } : {}),
    ...(opts.batchId ? { batchId: opts.batchId } : {}),
    ...(item ? { item } : {}),
    paths: h.paths,
    logger: silentLogger,
    clock: h.clock,
    signal: new AbortController().signal,
    deps: {
      repos: h.repos as unknown as Record<string, unknown>,
      ai,
      retrieval,
      collections: h.collections,
      relationships: h.relationships,
      queue: h.queue,
      events: h.events
    }
  }
}

const run = (stage: Stage, ai: AIProvider, opts: { itemId?: string; batchId?: string } = {}): Promise<StagePatch> =>
  stageByName(stage).run(ctx(ai, opts))

const understanding: Understanding = {
  kind: 'article',
  title: 'Continuous batching for LLM inference',
  summary: 'Engineering article comparing static and continuous batching for transformer inference.',
  whyUseful: 'Reference for cutting GPU serving cost.',
  topics: ['llm inference', 'batching'],
  entities: ['vLLM', 'Anyscale'],
  retrievalHints: ['continuous batching article', 'cheaper inference throughput'],
  suggestedActions: ['summarize_argument'],
  confidence: 0.82
}

async function readyItem(input: Partial<Item> & { title: string }): Promise<Item> {
  const item = h.item({ processingStatus: 'READY', ...input })
  await retrieval.indexItem(item.id)
  return h.repos.items.get(item.id) as Item
}

describe('stage list', () => {
  it('keeps the frozen names and lanes', () => {
    expect(STAGES.map((s) => `${s.name}:${s.lane}`)).toEqual([
      'extract:io',
      'thumbnail:io',
      'snapshot:io',
      'embed:embed',
      'index:embed',
      'understand:ai',
      'relate:ai',
      'organize_batch:ai',
      'consolidate:ai'
    ])
  })
})

describe('embed + index stages', () => {
  it('embed stores body chunks and index refreshes FTS + chunk 0 idempotently', async () => {
    const item = h.item({ title: 'Notes', extractedText: 'Hyperliquid runs an order book on chain. HyperBFT is fast.' })
    const ai = createScriptedProvider()
    expect(await run('embed', ai, { itemId: item.id })).toEqual({ outcome: 'ok' })
    expect(h.repos.embeddings.forItem(item.id).map((r) => r.role)).toEqual(['body'])
    expect(await run('index', ai, { itemId: item.id })).toEqual({ outcome: 'ok' })
    expect(h.repos.embeddings.forItem(item.id).map((r) => r.chunkIndex)).toEqual([0, 1])
    await run('index', ai, { itemId: item.id })
    expect(h.repos.embeddings.forItem(item.id)).toHaveLength(2)
    expect((await retrieval.quickSearch('hyperliquid'))[0]?.id).toBe(item.id)
  })

  it('index without a retrieval service still resyncs the FTS row', async () => {
    const item = h.item({ title: 'Solo' })
    const context = ctx(createScriptedProvider(), { itemId: item.id })
    delete context.deps.retrieval
    expect(await stageByName('index').run(context)).toEqual({ outcome: 'ok' })
  })
})

describe('understand stage', () => {
  it('writes understanding columns through the patch and records a run', async () => {
    const item = h.item({
      type: 'url',
      title: 'anyscale blog',
      url: 'https://anyscale.com/blog/x',
      domain: 'anyscale.com'
    })
    const ai = createScriptedProvider([jsonResponse(understanding)])
    const patch = await run('understand', ai, { itemId: item.id })
    expect(patch.outcome).toBe('ok')
    expect(patch.item).toMatchObject({
      title: understanding.title,
      kind: 'article',
      understanding: understanding.summary,
      whyUseful: understanding.whyUseful,
      topics: understanding.topics,
      entities: understanding.entities,
      retrievalHints: understanding.retrievalHints,
      suggestedActions: ['summarize_argument'],
      aiConfidence: 0.82,
      visionText: null
    })
    expect(ai.calls[0]?.task).toBe('understand')
    const runs = h.repos.agentRuns.latestForItem(item.id, 5)
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ task: 'understand', status: 'succeeded' })
    const events = h.eventsNamed('agent.run')
    expect(events.map((e) => e.status)).toEqual(['running', 'running', 'succeeded'])
    expect(events[1]?.step?.label).toMatch(/Reading "anyscale blog"/)
  })

  it('honours user overrides', async () => {
    const item = h.item({ title: 'My title', userOverrides: { title: true, understanding: true } })
    const patch = await run('understand', createScriptedProvider([jsonResponse(understanding)]), { itemId: item.id })
    expect(patch.item?.title).toBeUndefined()
    expect(patch.item?.understanding).toBeUndefined()
    expect(patch.item?.whyUseful).toBe(understanding.whyUseful)
    expect(patch.message).toBe('Kept your edits.')
  })

  it('rethrows AI_NOT_CONFIGURED so the scheduler parks the job', async () => {
    const item = h.item({ title: 'Parked' })
    await expect(run('understand', createOffProvider(), { itemId: item.id })).rejects.toSatisfy(
      (e: unknown) => isKaError(e) && e.code === 'AI_NOT_CONFIGURED'
    )
    expect(h.repos.agentRuns.latestForItem(item.id, 5)[0]?.status).toBe('failed')
  })

  it('throws AI_NOT_CONFIGURED when no provider is wired at all', async () => {
    const item = h.item({ title: 'No AI' })
    const context = ctx(createScriptedProvider(), { itemId: item.id })
    delete context.deps.ai
    await expect(stageByName('understand').run(context)).rejects.toSatisfy(
      (e: unknown) => isKaError(e) && e.code === 'AI_NOT_CONFIGURED'
    )
  })

  it('returns a definitive failure when the model never produces valid JSON', async () => {
    const item = h.item({ title: 'Nonsense' })
    const ai = createScriptedProvider([textResponse('no json here'), textResponse('still nothing')])
    const patch = await run('understand', ai, { itemId: item.id })
    expect(patch.outcome).toBe('failed')
    expect(patch.message).toBe('Still figuring this one out.')
    expect(patch.error).toMatch(/schema/)
    expect(ai.calls).toHaveLength(2)
  })

  it('retries a truncated answer once with a smaller text budget, then fails', async () => {
    const item = h.item({ title: 'Long', extractedText: 'x'.repeat(20_000) })
    const ai = createScriptedProvider([
      textResponse('{"kind":', 'length'),
      textResponse('{"kind":', 'length'),
      textResponse('{"kind":', 'length'),
      textResponse('{"kind":', 'length')
    ])
    const patch = await run('understand', ai, { itemId: item.id })
    expect(patch.outcome).toBe('failed')
    expect(patch.error).toMatch(/truncated/)
    const textOf = (i: number): string => JSON.stringify(ai.calls[i]?.messages ?? [])
    expect(textOf(2).length).toBeLessThan(textOf(0).length)
  })

  it('uses the folder schema for folders and can create a collection for ≥ 3 children', async () => {
    const folder = h.item({
      type: 'folder',
      title: 'serving-benchmark',
      metadata: {
        folder: { fileCount: 3, dirCount: 0, totalBytes: 10, truncated: false, extensions: { py: 1, csv: 1, md: 1 } }
      }
    })
    const kids = ['README.md', 'run_bench.py', 'results.csv'].map((title) =>
      h.item({ title, parentItemId: folder.id, extractedText: `${title} content about vllm load tests` })
    )
    const ai = createScriptedProvider([
      jsonResponse({
        understanding: { ...understanding, kind: 'dataset', title: 'Serving benchmark' },
        purpose: 'A load test harness for LLM serving configurations.',
        keyFiles: [{ path: 'run_bench.py', why: 'Entry point.' }],
        collection: {
          name: 'LLM serving benchmark',
          description: 'Scripts, configs and results of the serving load test; not general inference reading.',
          confidence: 0.8
        }
      })
    ])
    const patch = await run('understand', ai, { itemId: folder.id })
    expect(patch.outcome).toBe('ok')
    expect(patch.item?.kind).toBe('dataset')
    expect(patch.metadataPatch).toMatchObject({
      folder: { purpose: 'A load test harness for LLM serving configurations.' }
    })
    const collections = h.repos.collections.list()
    expect(collections).toHaveLength(1)
    expect(collections[0]?.createdBy).toBe('agent')
    expect(
      h.repos.collections
        .members(collections[0]?.id as string)
        .map((m) => m.itemId)
        .sort()
    ).toEqual(kids.map((k) => k.id).sort())
    expect(h.repos.audit.latest(10).some((e) => e.action === 'create_collection' && e.agentRunId)).toBe(true)
  })
})

describe('relate stage', () => {
  it('creates confident relationships and memberships with audit rows, rejects the rest', async () => {
    const a = await readyItem({
      title: 'vLLM repo',
      topics: ['llm serving'],
      entities: ['vLLM'],
      understanding: 'Serving engine.'
    })
    const b = await readyItem({
      title: 'PagedAttention paper',
      topics: ['llm serving'],
      entities: ['vLLM'],
      understanding: 'Paper behind vLLM.'
    })
    const c = await readyItem({ title: 'Unrelated cake recipe', topics: ['baking'], understanding: 'A cake.' })
    const collection = h.collections.create({
      name: 'LLM serving research',
      description: 'Serving papers and engines.',
      createdBy: 'user'
    })
    h.collections.addItems(collection.id, [{ itemId: b.id }], { actor: 'user' })
    const ai = createScriptedProvider([
      jsonResponse({
        relationships: [
          {
            sourceId: a.id,
            targetId: b.id,
            type: 'references',
            description: 'The repo implements the paper.',
            confidence: 0.9
          },
          { sourceId: a.id, targetId: b.id, type: 'related_to', description: 'Same pair again.', confidence: 0.85 },
          { sourceId: a.id, targetId: c.id, type: 'related_to', description: 'Weak.', confidence: 0.5 },
          { sourceId: a.id, targetId: 'ghost', type: 'related_to', description: 'Made up.', confidence: 0.95 }
        ],
        addToCollections: [
          { collectionId: collection.id, itemId: a.id, confidence: 0.85, reason: 'Core serving engine.' }
        ],
        newCollections: [],
        understandingPatches: [{ itemId: a.id, topics: ['kv cache'], reason: 'Missing topic.' }],
        summary: 'This looks like part of your LLM serving research.',
        confidence: 0.8
      })
    ])
    const patch = await run('relate', ai, { itemId: a.id })
    expect(patch.outcome).toBe('ok')
    expect(patch.message).toBe('This looks like part of your LLM serving research.')
    expect(patch.item?.topics).toEqual(['llm serving', 'kv cache'])
    const rels = h.repos.relationships.forItem(a.id)
    expect(rels).toHaveLength(1)
    expect(rels[0]).toMatchObject({ type: 'references', createdBy: 'agent', confidence: 0.9 })
    expect(rels[0]?.agentRunId).toBeTruthy()
    expect(h.repos.collections.getMember(collection.id, a.id)?.reason).toBe('Core serving engine.')
    const audit = h.repos.audit
      .forRun(rels[0]?.agentRunId as string)
      .map((e) => e.action)
      .sort()
    expect(audit).toEqual(['add_to_collection', 'create_relationship'])
    const request = JSON.stringify(ai.calls[0]?.messages)
    expect(request).toContain('Existing collections')
    expect(request).toContain(b.id)
  })

  it('never re-creates a relationship the person removed', async () => {
    const a = await readyItem({ title: 'A about vllm', topics: ['vllm'], understanding: 'vllm' })
    const b = await readyItem({ title: 'B about vllm', topics: ['vllm'], understanding: 'vllm' })
    const rel = h.relationships.create({ sourceId: a.id, targetId: b.id, type: 'related_to', createdBy: 'agent' })
    h.relationships.remove(rel.id, { actor: 'user' })
    const ai = createScriptedProvider([
      jsonResponse({
        relationships: [
          { sourceId: a.id, targetId: b.id, type: 'same_project', description: 'Same.', confidence: 0.95 }
        ],
        addToCollections: [],
        newCollections: [],
        understandingPatches: [],
        summary: 'Linked.',
        confidence: 0.8
      })
    ])
    await run('relate', ai, { itemId: a.id })
    expect(h.repos.relationships.forItem(a.id)).toHaveLength(0)
    expect(JSON.stringify(ai.calls[0]?.messages)).toMatch(/Do not connect/)
  })

  it('marks near-duplicates without asking the model and skips the call when nothing is around', async () => {
    const a = await readyItem({
      type: 'url',
      title: 'Raycast — launcher for macOS',
      domain: 'raycast.com',
      understanding: 'Launcher.'
    })
    const dup = await readyItem({
      type: 'url',
      title: 'Raycast – launcher for macOS',
      domain: 'raycast.com',
      understanding: 'Launcher.'
    })
    const ai = createScriptedProvider([
      jsonResponse({
        relationships: [],
        addToCollections: [],
        newCollections: [],
        understandingPatches: [],
        summary: 'Nothing else.',
        confidence: 0.6
      })
    ])
    const patch = await run('relate', ai, { itemId: a.id })
    expect(patch.outcome).toBe('ok')
    const rels = h.repos.relationships.forItem(a.id)
    expect(rels.map((r) => r.type)).toEqual(['duplicate_of'])
    expect(rels[0]?.targetItemId === dup.id || rels[0]?.sourceItemId === dup.id).toBe(true)

    const lonely = await readyItem({ title: 'zzqx completely unique thing', understanding: 'nothing shared' })
    h.close()
    h = createHarness()
    retrieval = createRetrieval({ db: h.db, repos: h.repos, logger: silentLogger, clock: h.clock })
    await retrieval.warm()
    const solo = h.item({ title: lonely.title, processingStatus: 'READY' })
    const quiet = createScriptedProvider()
    const result = await run('relate', quiet, { itemId: solo.id })
    expect(result).toEqual({
      outcome: 'ok',
      message: 'Kept on its own for now; nothing else in the library is about this yet.'
    })
    expect(quiet.calls).toHaveLength(0)
  })
})

describe('organize_batch stage', () => {
  async function batch(): Promise<Item[]> {
    const items: Item[] = []
    for (const title of ['MiniMax article', 'MiniMax-M1 repo', 'Inference PDF', 'Pricing screenshot']) {
      items.push(
        await readyItem({ title, captureBatchId: 'b1', topics: ['minimax'], understanding: `${title} about MiniMax.` })
      )
    }
    return items
  }

  it('creates a collection only for ≥ 3 coherent members and prefers existing ones', async () => {
    const items = await batch()
    const [a, b, c, d] = items as [Item, Item, Item, Item]
    const existing = h.collections.create({
      name: 'MiniMax research',
      description: 'Everything about the MiniMax models.',
      createdBy: 'agent'
    })
    const ai = createScriptedProvider([
      jsonResponse({
        relationships: [
          { sourceId: a.id, targetId: b.id, type: 'same_project', description: 'Both MiniMax.', confidence: 0.85 }
        ],
        addToCollections: [],
        newCollections: [
          {
            name: 'Technology',
            description: 'x'.repeat(80),
            members: [
              { itemId: a.id, reason: 'r' },
              { itemId: b.id, reason: 'r' },
              { itemId: c.id, reason: 'r' }
            ],
            confidence: 0.9
          },
          {
            name: 'Inference pricing notes',
            description: 'Pricing pages and notes on inference providers and what they charge per token.',
            members: [
              { itemId: c.id, reason: 'r' },
              { itemId: d.id, reason: 'r' }
            ],
            confidence: 0.9
          },
          {
            name: 'MiniMax Research',
            description: 'Articles, repos and papers about the MiniMax model family and its serving.',
            members: [
              { itemId: a.id, reason: 'The article.' },
              { itemId: b.id, reason: 'The repo.' },
              { itemId: c.id, reason: 'The PDF.' }
            ],
            confidence: 0.9
          }
        ],
        understandingPatches: [],
        summary: 'This looks like part of your MiniMax research.',
        confidence: 0.8
      })
    ])
    const patch = await run('organize_batch', ai, { batchId: 'b1' })
    expect(patch).toEqual({ outcome: 'ok', message: 'This looks like part of your MiniMax research.' })
    const collections = h.repos.collections.list()
    expect(collections.map((c) => c.name)).toEqual(['MiniMax research'])
    expect(
      h.repos.collections
        .members(existing.id)
        .map((m) => m.itemId)
        .sort()
    ).toEqual([a.id, b.id, c.id].sort())
    expect(h.repos.relationships.count()).toBe(1)
    const runs = h.repos.agentRuns.forBatch('b1')
    expect(runs[0]).toMatchObject({ task: 'organize_batch', status: 'succeeded' })
    expect(ai.calls[0]?.task).toBe('organize_batch')
  })

  it('never re-adds an item the person removed from a collection, and no-ops on empty batches', async () => {
    const items = await batch()
    const [a] = items as [Item]
    const collection = h.collections.create({ name: 'MiniMax research', description: 'd', createdBy: 'agent' })
    h.collections.addItems(collection.id, [{ itemId: a.id }], { actor: 'agent' })
    h.collections.removeItem(collection.id, a.id, { actor: 'user' })
    const ai = createScriptedProvider([
      jsonResponse({
        relationships: [],
        addToCollections: [{ collectionId: collection.id, itemId: a.id, confidence: 0.95, reason: 'Fits.' }],
        newCollections: [],
        understandingPatches: [],
        summary: 'Added.',
        confidence: 0.8
      })
    ])
    await run('organize_batch', ai, { batchId: 'b1' })
    expect(h.repos.collections.members(collection.id)).toHaveLength(0)
    expect(JSON.stringify(ai.calls[0]?.messages)).toMatch(/Do not add/)
    expect(await run('organize_batch', createScriptedProvider(), { batchId: 'nope' })).toEqual({ outcome: 'ok' })
  })

  it('schedules a consolidate sweep every third batch', async () => {
    const plan = jsonResponse({
      relationships: [],
      addToCollections: [],
      newCollections: [],
      understandingPatches: [],
      summary: 'Fine.',
      confidence: 0.7
    })
    for (const batchId of ['x1', 'x2', 'x3']) {
      await readyItem({ title: `item ${batchId}`, captureBatchId: batchId })
      await readyItem({ title: `other ${batchId}`, captureBatchId: batchId })
      await run('organize_batch', createScriptedProvider([plan]), { batchId })
    }
    expect(h.repos.jobs.activeForBatch('x1', 'consolidate')).toBeNull()
    expect(h.repos.jobs.activeForBatch('x3', 'consolidate')).toMatchObject({
      stage: 'consolidate',
      lane: 'ai',
      status: 'queued'
    })
  })
})

describe('consolidate stage', () => {
  it('merges only agent-created near-duplicates, refuses to rename user collections, and is undoable', async () => {
    const a = await readyItem({ title: 'vLLM repo', understanding: 'serving' })
    const b = await readyItem({ title: 'PagedAttention paper', understanding: 'serving' })
    const c = await readyItem({ title: 'TGI repo', understanding: 'serving' })
    const one = h.collections.create({ name: 'LLM serving research', description: 'd', createdBy: 'agent' })
    const two = h.collections.create({ name: 'LLM serving engines', description: 'd', createdBy: 'agent' })
    const user = h.collections.create({ name: 'My reading list', description: 'd', createdBy: 'user' })
    h.collections.addItems(one.id, [{ itemId: a.id }, { itemId: b.id }], { actor: 'agent' })
    h.collections.addItems(two.id, [{ itemId: c.id }], { actor: 'agent' })
    const ai = createScriptedProvider([
      jsonResponse({
        renames: [
          { collectionId: user.id, name: 'Renamed by agent', description: 'x', reason: 'r' },
          {
            collectionId: one.id,
            name: 'LLM serving research and engines',
            description: 'Everything about serving LLMs.',
            reason: 'Merged scope.'
          }
        ],
        merges: [
          { fromCollectionId: two.id, intoCollectionId: one.id, reason: 'Same context.' },
          { fromCollectionId: user.id, intoCollectionId: one.id, reason: 'Nope.' }
        ],
        addToCollections: [],
        newCollections: [],
        relationships: [],
        summary: 'Merged two serving collections.',
        confidence: 0.8
      })
    ])
    const patch = await run('consolidate', ai, { batchId: 'b9' })
    expect(patch).toEqual({ outcome: 'ok', message: 'Merged two serving collections.' })
    expect(h.repos.collections.get(user.id)?.name).toBe('My reading list')
    expect(h.repos.collections.get(two.id)).toBeNull()
    expect(h.repos.collections.get(one.id)?.name).toBe('LLM serving research and engines')
    expect(
      h.repos.collections
        .members(one.id)
        .map((m) => m.itemId)
        .sort()
    ).toEqual([a.id, b.id, c.id].sort())
    const runId = h.repos.agentRuns.forBatch('b9')[0]?.id as string
    const entries = h.repos.audit.forRun(runId)
    expect(entries.map((e) => e.action).sort()).toEqual(['add_to_collection', 'rename_collection'])
    for (const entry of [...entries].reverse()) h.audit.undo(entry.id)
    expect(h.repos.collections.get(one.id)?.name).toBe('LLM serving research')
    expect(
      h.repos.collections
        .members(one.id)
        .map((m) => m.itemId)
        .sort()
    ).toEqual([a.id, b.id].sort())
  })

  it('does nothing without collections', async () => {
    const quiet = createScriptedProvider()
    expect(await run('consolidate', quiet, { batchId: 'b0' })).toEqual({
      outcome: 'ok',
      message: 'Nothing to tidy up.'
    })
    expect(quiet.calls).toHaveLength(0)
  })
})

describe('provider swap', () => {
  it('reads deps.ai at call time (a getter is accepted)', async () => {
    const item = h.item({ title: 'Swap' })
    let current: ScriptedProvider = createScriptedProvider([textResponse('junk'), textResponse('junk')])
    const context = ctx(current, { itemId: item.id })
    context.deps.ai = (() => current) as unknown as AIProvider
    current = createScriptedProvider([jsonResponse(understanding)])
    const patch = await stageByName('understand').run(context)
    expect(patch.outcome).toBe('ok')
  })
})
