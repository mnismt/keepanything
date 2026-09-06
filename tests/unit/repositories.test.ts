import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { blobToVector, vectorToBlob } from '../../src/main/storage/repositories/embedding-repo'
import type { Job } from '../../src/shared/types'
import { createHarness, type Harness } from './helpers/harness'

let h: Harness

beforeEach(() => {
  h = createHarness()
})
afterEach(() => h.close())

const fts = (query: string): string[] =>
  (
    h.db.prepare('SELECT item_id FROM items_fts WHERE items_fts MATCH ? ORDER BY rank').all(query) as {
      item_id: string
    }[]
  ).map((r) => r.item_id)

describe('item repository', () => {
  it('round-trips every column, including JSON and booleans', () => {
    const created = h.item({
      type: 'url',
      subtype: 'article',
      kind: 'article',
      title: 'Batching strategies',
      url: 'https://example.com/a',
      canonicalUrl: 'https://example.com/a',
      domain: 'example.com',
      topics: ['inference', 'gpu'],
      entities: ['vLLM'],
      retrievalHints: ['cheap inference'],
      metadata: { og: { siteName: 'Example' }, custom: 1 },
      userOverrides: { title: true },
      isMissing: true,
      aiConfidence: 0.7,
      thumbnailPath: 'x.png',
      mediaVersion: 3
    })
    const loaded = h.repos.items.get(created.id)
    expect(loaded).toEqual(created)
    expect(loaded?.isMissing).toBe(true)
    expect(loaded?.metadata).toEqual({ og: { siteName: 'Example' }, custom: 1 })
  })

  it('keeps the FTS row in sync on insert, update, trash, restore and delete', () => {
    const item = h.item({ title: 'Globe animation website', domain: 'example.com' })
    expect(fts('"globe"')).toEqual([item.id])
    h.repos.items.update(item.id, { understanding: 'Landing page with warm typography' })
    expect(fts('"typography"')).toEqual([item.id])
    h.repos.items.patchMetadata(item.id, { og: { description: 'inference batching' } })
    expect(fts('meta_text:"batching"')).toEqual([item.id])
    h.repos.items.setDeleted([item.id], h.clock.nowIso())
    expect(fts('"globe"')).toEqual([])
    h.repos.items.setDeleted([item.id], null)
    expect(fts('"globe"')).toEqual([item.id])
    h.repos.items.deleteForever([item.id])
    expect(fts('"globe"')).toEqual([])
    expect(h.repos.items.get(item.id)).toBeNull()
  })

  it('builds summaries with media URLs, collection ids and folder children', () => {
    const folder = h.item({ type: 'folder', title: 'Research' })
    const child1 = h.item({
      type: 'image',
      title: 'a',
      parentItemId: folder.id,
      thumbnailPath: 'a.png',
      mediaVersion: 2
    })
    h.item({ type: 'text', title: 'b', parentItemId: folder.id })
    const collection = h.collections.create({ name: 'mnismt', createdBy: 'user' })
    h.collections.addItems(collection.id, [{ itemId: folder.id }], { actor: 'user' })
    h.repos.items.update(folder.id, { understanding: 'x'.repeat(400) })

    const summary = h.repos.items.summary(folder.id)
    expect(summary?.childCount).toBe(2)
    expect(summary?.childThumbnailUrls).toEqual(['ka-media://local/thumbs/a.png?v=2'])
    expect(summary?.collectionIds).toEqual([collection.id])
    expect(summary?.understanding?.length).toBe(160)
    expect(summary?.thumbnailUrl).toBeNull()
    expect(h.repos.items.summary(child1.id)?.thumbnailUrl).toBe('ka-media://local/thumbs/a.png?v=2')
  })

  it('lists views correctly', () => {
    const folder = h.item({ type: 'folder', title: 'F' })
    const child = h.item({ type: 'text', title: 'child', parentItemId: folder.id })
    const link = h.item({ type: 'url', title: 'link', url: 'https://x.y' })
    const ready = h.item({
      type: 'pdf',
      title: 'old ready',
      processingStatus: 'READY',
      capturedAt: '2026-01-01T00:00:00.000Z'
    })
    const trashed = h.item({ type: 'image', title: 'gone' })
    h.repos.items.setDeleted([trashed.id], h.clock.nowIso())
    const ids = (view: Parameters<typeof h.repos.items.list>[0]['view'], extra = {}): string[] =>
      h.repos.items.list({ view, ...extra }).map((i) => i.id)

    expect(ids('library')).toEqual(expect.arrayContaining([folder.id, link.id, ready.id]))
    expect(ids('library')).not.toContain(child.id)
    expect(ids('library')).not.toContain(trashed.id)
    expect(ids('links')).toEqual([link.id])
    expect(ids('files')).toEqual(expect.arrayContaining([folder.id, ready.id]))
    expect(ids('files')).not.toContain(link.id)
    expect(ids('trash')).toEqual([trashed.id])
    expect(ids('library', { types: ['pdf'] })).toEqual([ready.id])
    const collection = h.collections.create({ name: 'C', createdBy: 'user' })
    h.collections.addItems(collection.id, [{ itemId: link.id }], { actor: 'user' })
    expect(ids('collection', { collectionId: collection.id })).toEqual([link.id])
  })

  it('finds duplicates by hash and canonical url, and counts stats', () => {
    const a = h.item({ contentHash: 'abc' })
    const b = h.item({ type: 'url', url: 'https://a.b/c', canonicalUrl: 'https://a.b/c' })
    expect(h.repos.items.findByHash('abc')?.id).toBe(a.id)
    expect(h.repos.items.findByCanonicalUrl('https://a.b/c')?.id).toBe(b.id)
    expect(h.repos.items.stats()).toEqual({ items: 2, connections: 0, collections: 0, processing: 2 })
  })
})

describe('collection repository', () => {
  it('stores collections, memberships and cover thumbnails', () => {
    const c = h.collections.create({ name: 'Local LLM inference research', description: 'd', createdBy: 'agent' })
    expect(c.createdBy).toBe('agent')
    expect(h.repos.collections.getByNameKey('local llm inference research')?.id).toBe(c.id)
    const withThumb = h.item({ thumbnailPath: 't.png' })
    const plain = h.item()
    h.collections.addItems(c.id, [{ itemId: withThumb.id, reason: 'why', confidence: 0.8 }, { itemId: plain.id }], {
      actor: 'agent'
    })
    const [summary] = h.repos.collections.listSummaries()
    expect(summary?.count).toBe(2)
    expect(summary?.coverThumbnailUrls).toEqual(['ka-media://local/thumbs/t.png?v=1'])
    expect(h.repos.collections.getMember(c.id, withThumb.id)).toMatchObject({
      reason: 'why',
      confidence: 0.8,
      addedBy: 'agent'
    })
    expect(h.repos.collections.membershipsForItem(plain.id)).toHaveLength(1)
    h.repos.collections.delete(c.id)
    expect(h.repos.collections.membershipsForItem(plain.id)).toHaveLength(0)
  })
})

describe('relationship repository', () => {
  it('stores edges and finds them from either side', () => {
    const a = h.item()
    const b = h.item()
    const r = h.relationships.create({ sourceId: b.id, targetId: a.id, type: 'related_to', createdBy: 'user' })
    // symmetric types are normalized so source < target
    expect([r.sourceItemId, r.targetItemId]).toEqual([a.id, b.id].sort())
    expect(h.repos.relationships.forItem(a.id)).toHaveLength(1)
    expect(h.repos.relationships.between(b.id, a.id)).toHaveLength(1)
    expect(h.repos.relationships.find(r.sourceItemId, r.targetItemId, 'related_to')?.id).toBe(r.id)
    expect(h.repos.relationships.count()).toBe(1)
  })
})

describe('job repository', () => {
  const job = (overrides: Partial<Job>): Job => ({
    id: overrides.id ?? `j-${Math.random()}`,
    itemId: null,
    batchId: null,
    stage: 'extract',
    lane: 'io',
    priority: 0,
    status: 'queued',
    attempts: 0,
    runAfter: null,
    lastError: null,
    createdAt: h.clock.nowIso(),
    updatedAt: h.clock.nowIso(),
    ...overrides
  })

  it('refuses a second active job for the same item and stage', () => {
    const item = h.item()
    expect(h.repos.jobs.insert(job({ id: 'a', itemId: item.id }))).not.toBeNull()
    expect(h.repos.jobs.insert(job({ id: 'b', itemId: item.id }))).toBeNull()
    expect(h.repos.jobs.insert(job({ id: 'c', itemId: item.id, stage: 'thumbnail' }))).not.toBeNull()
  })

  it('claims by priority then age, honours run_after, increments attempts', () => {
    const a = h.item()
    const b = h.item()
    const c = h.item()
    h.repos.jobs.insert(job({ id: 'low', itemId: a.id, priority: 1, createdAt: '2026-01-01T00:00:00.000Z' }))
    h.repos.jobs.insert(job({ id: 'high', itemId: b.id, priority: 9 }))
    h.repos.jobs.insert(job({ id: 'later', itemId: c.id, priority: 99, runAfter: '2026-09-03T10:05:00.000Z' }))
    const first = h.repos.jobs.claim('io', h.clock.nowIso())
    expect(first?.id).toBe('high')
    expect(first?.status).toBe('running')
    expect(first?.attempts).toBe(1)
    expect(h.repos.jobs.claim('io', h.clock.nowIso())?.id).toBe('low')
    expect(h.repos.jobs.claim('io', h.clock.nowIso())).toBeNull()
    expect(h.repos.jobs.claim('ai', h.clock.nowIso())).toBeNull()
    h.clock.advance(5 * 60_000)
    expect(h.repos.jobs.claim('io', h.clock.nowIso())?.id).toBe('later')
  })

  it('finishes, requeues with backoff, parks, cancels and resets crashed jobs', () => {
    const item = h.item()
    h.repos.jobs.insert(job({ id: 'j', itemId: item.id }))
    const claimed = h.repos.jobs.claim('io', h.clock.nowIso())
    expect(claimed?.id).toBe('j')
    h.repos.jobs.requeue('j', '2026-09-03T10:00:30.000Z', h.clock.nowIso(), 'boom')
    expect(h.repos.jobs.get('j')).toMatchObject({
      status: 'queued',
      runAfter: '2026-09-03T10:00:30.000Z',
      lastError: 'boom',
      attempts: 1
    })
    h.repos.jobs.park('j', null, h.clock.nowIso())
    expect(h.repos.jobs.get('j')).toMatchObject({ status: 'queued', attempts: 0, runAfter: null })
    h.repos.jobs.claim('io', h.clock.nowIso())
    expect(h.repos.jobs.resetRunning(3, h.clock.nowIso())).toEqual({ requeued: 1, failed: 0 })
    h.repos.jobs.claim('io', h.clock.nowIso())
    h.db.prepare("UPDATE jobs SET attempts = 3 WHERE id = 'j'").run()
    expect(h.repos.jobs.resetRunning(3, h.clock.nowIso())).toEqual({ requeued: 0, failed: 1 })
    expect(h.repos.jobs.get('j')).toMatchObject({ status: 'failed', lastError: 'crashed' })
    expect(h.repos.jobs.finishedStages(item.id)).toEqual(new Set(['extract']))

    h.repos.jobs.insert(job({ id: 'k', itemId: item.id, stage: 'thumbnail' }))
    expect(h.repos.jobs.cancelForItems([item.id], h.clock.nowIso()).map((j) => j.id)).toEqual(['k'])
    expect(h.repos.jobs.activeForItem(item.id)).toEqual([])
    expect(h.repos.jobs.activeProgress()).toEqual([])
  })

  it('treats a re-enqueued stage as unfinished until its latest job finishes', () => {
    const item = h.item()
    h.repos.jobs.insert(job({ id: 'first', itemId: item.id, createdAt: '2026-01-01T00:00:00.000Z' }))
    h.repos.jobs.finish('first', 'done', h.clock.nowIso())
    expect(h.repos.jobs.finishedStages(item.id)).toEqual(new Set(['extract']))
    h.repos.jobs.insert(job({ id: 'second', itemId: item.id }))
    expect(h.repos.jobs.finishedStages(item.id)).toEqual(new Set())
    expect(h.repos.jobs.latestPerStage(item.id).get('extract')?.id).toBe('second')
  })

  it('exposes batch jobs and progress rows joined with the item status', () => {
    const item = h.item()
    h.repos.jobs.insert(job({ id: 'b', batchId: 'batch', stage: 'organize_batch', lane: 'ai' }))
    h.repos.jobs.insert(job({ id: 'i', itemId: item.id }))
    expect(h.repos.jobs.activeForBatch('batch', 'organize_batch')?.id).toBe('b')
    expect(h.repos.jobs.latestForBatch('batch', 'organize_batch')?.id).toBe('b')
    const progress = h.repos.jobs.activeProgress()
    expect(progress).toContainEqual({
      itemId: null,
      batchId: 'batch',
      processingStatus: null,
      stage: 'organize_batch',
      jobStatus: 'queued',
      attempts: 0
    })
    expect(progress).toContainEqual({
      itemId: item.id,
      batchId: null,
      processingStatus: 'CAPTURED',
      stage: 'extract',
      jobStatus: 'queued',
      attempts: 0
    })
  })
})

describe('embedding, agent run, audit and suppression repositories', () => {
  it('round-trips vectors as float32 blobs and replaces per item', () => {
    const item = h.item()
    const row = {
      itemId: item.id,
      chunkIndex: 0,
      role: 'summary' as const,
      content: 'memory',
      model: 'm',
      dims: 4,
      vector: new Float32Array([0.1, 0.2, 0.3, 0.4])
    }
    h.repos.embeddings.replaceForItem(item.id, [row, { ...row, chunkIndex: 1, role: 'body' }])
    const loaded = h.repos.embeddings.forItem(item.id)
    expect(loaded).toHaveLength(2)
    expect(Array.from(loaded[0]?.vector ?? [])).toEqual(Array.from(row.vector))
    expect(h.repos.embeddings.allForModel('m')).toHaveLength(2)
    expect(h.repos.embeddings.countForModel('other')).toBe(0)
    h.repos.embeddings.replaceForItem(item.id, [row])
    expect(h.repos.embeddings.forItem(item.id)).toHaveLength(1)
  })

  it('stores agent runs and lists summaries for an item', () => {
    const item = h.item()
    h.repos.agentRuns.insert({
      id: 'run',
      itemId: item.id,
      batchId: null,
      task: 'understand',
      status: 'running',
      model: 'm',
      startedAt: h.clock.nowIso(),
      completedAt: null,
      stepCount: 0,
      error: null,
      steps: [],
      undoable: false,
      usage: null,
      result: null
    })
    h.repos.agentRuns.update('run', {
      status: 'succeeded',
      steps: [{ n: 1, tool: 'finish', kind: 'finish', label: 'Done', status: 'ok', durationMs: 5 }]
    })
    expect(h.repos.agentRuns.get('run')).toMatchObject({ status: 'succeeded', stepCount: 1, undoable: false })
    const [summary] = h.repos.agentRuns.latestForItem(item.id, 5)
    expect(summary).toMatchObject({ id: 'run', stepCount: 1, undoable: false })
    expect(summary?.steps).toHaveLength(1)
    expect(summary).not.toHaveProperty('result')
    expect(summary).not.toHaveProperty('usage')
    expect(h.repos.agentRuns.running()).toEqual([])
    // `undoable` follows the run's audit rows until they are undone.
    const entry = h.audit.record({
      actor: 'agent',
      action: 'update_understanding',
      entity: 'item',
      entityId: item.id,
      before: { title: item.title },
      after: { title: 'Renamed' },
      agentRunId: 'run'
    })
    expect(h.repos.agentRuns.get('run')?.undoable).toBe(true)
    expect(h.repos.agentRuns.latestForItem(item.id, 5)[0]?.undoable).toBe(true)
    h.audit.undo(entry.id)
    expect(h.repos.agentRuns.get('run')?.undoable).toBe(false)
  })

  it('records audit rows and suppressions', () => {
    const entry = h.audit.record({
      actor: 'agent',
      action: 'add_to_collection',
      entity: 'collection_item',
      entityId: 'c:i',
      after: { x: 1 },
      agentRunId: 'run'
    })
    expect(h.repos.audit.get(entry.id)).toEqual(entry)
    expect(h.repos.audit.forRun('run')).toHaveLength(1)
    expect(h.repos.audit.forEntity('collection_item', 'c:i')).toHaveLength(1)
    h.repos.suppressions.add('relationship', 'a:b', h.clock.nowIso())
    h.repos.suppressions.add('relationship', 'a:b', h.clock.nowIso())
    expect(h.repos.suppressions.has('relationship', 'a:b')).toBe(true)
    expect(h.repos.suppressions.keys('relationship')).toEqual(new Set(['a:b']))
    h.repos.suppressions.remove('relationship', 'a:b')
    expect(h.repos.suppressions.has('relationship', 'a:b')).toBe(false)
  })
})

describe('embedding blobs', () => {
  it('decodes by BLOB length when the dims column is missing or 0', () => {
    const blob = vectorToBlob(Float32Array.from([0.5, 0.25, 0.125]))
    expect(Array.from(blobToVector(blob, 3))).toEqual([0.5, 0.25, 0.125])
    expect(Array.from(blobToVector(blob, 0))).toEqual([0.5, 0.25, 0.125])
    expect(Array.from(blobToVector(blob, 2))).toEqual([0.5, 0.25])
  })
})
