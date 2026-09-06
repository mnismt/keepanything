import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initialStages, isLastStage, nextStages, stagesFrom } from '../../src/main/pipeline/graph'
import { LIMITS } from '../../src/shared/constants'
import type { Item, Job, Stage } from '../../src/shared/types'
import { createHarness, type Harness } from './helpers/harness'

let h: Harness

beforeEach(() => {
  h = createHarness()
})
afterEach(() => h.close())

const activeStages = (item: Item): Stage[] =>
  h.repos.jobs
    .activeForItem(item.id)
    .map((j) => j.stage)
    .sort()
const claimStage = (item: Item, stage: Stage): Job => {
  const job = h.repos.jobs.activeForItem(item.id).find((j) => j.stage === stage && j.status === 'queued')
  if (!job) throw new Error(`no queued ${stage} job`)
  h.db.prepare("UPDATE jobs SET status = 'running', attempts = attempts + 1 WHERE id = ?").run(job.id)
  return { ...job, status: 'running', attempts: job.attempts + 1 }
}
const status = (item: Item): string => h.repos.items.get(item.id)?.processingStatus ?? 'missing'

describe('graph', () => {
  it('defines initial stages, unlocking and last stages per type', () => {
    expect(initialStages('url')).toEqual(['extract', 'snapshot'])
    expect(initialStages('image')).toEqual(['thumbnail'])
    expect(initialStages('note')).toEqual(['embed', 'index'])
    expect(nextStages('url', 'extract', new Set(['extract']))).toEqual([])
    expect(nextStages('url', 'snapshot', new Set(['extract', 'snapshot']))).toEqual(['embed', 'understand'])
    expect(nextStages('pdf', 'understand', new Set(['extract', 'thumbnail', 'understand']))).toEqual(['index'])
    expect(isLastStage('note', 'index')).toBe(true)
    expect(isLastStage('url', 'index')).toBe(false)
    expect(stagesFrom('url', 'understand')).toEqual(['understand', 'index', 'relate'])
    expect(stagesFrom('image', 'extract')).toEqual([])
  })
})

describe('state applier', () => {
  it('walks a document through extract → embed/understand → index → relate → READY', () => {
    const item = h.item({ type: 'pdf' })
    h.queue.enqueueInitial(item)
    expect(activeStages(item)).toEqual(['extract', 'thumbnail'])

    const extract = claimStage(item, 'extract')
    expect(h.state.applyEntry(extract).item?.processingStatus).toBe('EXTRACTING')
    const r1 = h.state.applyResult(extract, {
      outcome: 'ok',
      item: { extractedText: 'hello', pageCount: 3 },
      metadataPatch: { headings: ['a'] }
    })
    expect(status(item)).toBe('EXTRACTED')
    expect(h.repos.items.get(item.id)).toMatchObject({
      extractedText: 'hello',
      pageCount: 3,
      metadata: { headings: ['a'] }
    })
    expect(r1.enqueued).toEqual([]) // waits for thumbnail
    expect(r1.progress).toMatchObject({
      itemId: item.id,
      stage: 'extract',
      jobStatus: 'done',
      processingStatus: 'EXTRACTED'
    })

    const thumb = claimStage(item, 'thumbnail')
    h.state.applyResult(thumb, { outcome: 'ok', item: { thumbnailPath: 't.png', width: 10, height: 20 } })
    expect(status(item)).toBe('EXTRACTED')
    expect(activeStages(item)).toEqual(['embed', 'understand'])

    const understand = claimStage(item, 'understand')
    h.state.applyEntry(understand)
    expect(status(item)).toBe('UNDERSTANDING')
    const r2 = h.state.applyResult(understand, { outcome: 'ok', item: { understanding: 'A paper', kind: 'paper' } })
    expect(status(item)).toBe('RELATING')
    expect(r2.enqueued.map((j) => j.stage)).toEqual(['index'])

    const embed = claimStage(item, 'embed')
    h.state.applyEntry(embed)
    expect(status(item)).toBe('RELATING') // never moves backwards
    h.state.applyResult(embed, { outcome: 'ok' })

    const index = claimStage(item, 'index')
    const r3 = h.state.applyResult(index, { outcome: 'ok' })
    expect(r3.enqueued.map((j) => j.stage)).toEqual(['relate'])

    const relate = claimStage(item, 'relate')
    const r4 = h.state.applyResult(relate, { outcome: 'ok' })
    expect(status(item)).toBe('READY')
    expect(r4.settledIds).toEqual([item.id])
    expect(h.repos.jobs.activeForItem(item.id)).toEqual([])
  })

  it('stage patches only touch whitelisted columns and status is derived, never patched', () => {
    const item = h.item({ type: 'text' })
    h.queue.enqueueInitial(item)
    const extract = claimStage(item, 'extract')
    h.state.applyResult(extract, {
      outcome: 'ok',
      item: { title: 'New', processingStatus: 'READY', id: 'hacked', deletedAt: 'x' } as unknown as Record<
        string,
        unknown
      >
    })
    const after = h.repos.items.get(item.id)
    expect(after).toMatchObject({ id: item.id, title: 'New', processingStatus: 'EXTRACTED', deletedAt: null })
  })

  it('extraction failure continues to understanding on metadata and ends PARTIAL', () => {
    const item = h.item({ type: 'markdown' })
    h.queue.enqueueInitial(item)
    h.state.applyResult(claimStage(item, 'thumbnail'), { outcome: 'ok' })
    h.state.applyResult(claimStage(item, 'extract'), { outcome: 'failed', error: 'unreadable' })
    expect(status(item)).toBe('EXTRACTION_FAILED')
    expect(h.repos.items.get(item.id)?.processingError).toBe('unreadable')
    expect(activeStages(item)).toEqual(['embed', 'understand'])
    const understand = claimStage(item, 'understand')
    expect(h.state.applyEntry(understand).item?.processingStatus).toBe('EXTRACTION_FAILED')
    h.state.applyResult(understand, { outcome: 'ok' })
    expect(status(item)).toBe('PARTIAL')
    h.state.applyResult(claimStage(item, 'index'), { outcome: 'ok' })
    h.state.applyResult(claimStage(item, 'relate'), { outcome: 'ok' })
    expect(status(item)).toBe('PARTIAL')
  })

  it('thrown errors retry with backoff while attempts remain, then fail; ai stages stop the graph', () => {
    const item = h.item({ type: 'image' })
    h.queue.enqueueInitial(item)
    h.state.applyResult(claimStage(item, 'thumbnail'), { outcome: 'ok' })
    let understand = claimStage(item, 'understand')
    h.state.applyEntry(understand)
    const retry = h.state.applyRetry(understand, 'provider 500')
    expect(status(item)).toBe('AI_FAILED')
    expect(retry.progress.jobStatus).toBe('queued')
    const requeued = h.repos.jobs.get(understand.id)
    expect(requeued?.runAfter).toBe(new Date(Date.parse(h.clock.nowIso()) + LIMITS.retryBackoffMs[0]).toISOString())
    expect(requeued?.lastError).toBe('provider 500')
    // Resuming from AI_FAILED shows UNDERSTANDING again.
    understand = claimStage(item, 'understand')
    expect(h.state.applyEntry(understand).item?.processingStatus).toBe('UNDERSTANDING')
    h.state.applyFailure(understand, 'gave up')
    expect(status(item)).toBe('AI_FAILED')
    expect(h.repos.jobs.get(understand.id)?.status).toBe('failed')
    expect(activeStages(item)).toEqual([]) // ai failure does not unlock index
    expect(h.state.backoffMs(1)).toBe(30_000)
    expect(h.state.backoffMs(3)).toBe(600_000)
    expect(h.state.backoffMs(9)).toBe(600_000)
  })

  it('an exhausted io failure still unlocks the graph', () => {
    const item = h.item({ type: 'text' })
    h.queue.enqueueInitial(item)
    h.state.applyResult(claimStage(item, 'thumbnail'), { outcome: 'ok' })
    h.state.applyFailure(claimStage(item, 'extract'), 'disk error')
    expect(status(item)).toBe('EXTRACTION_FAILED')
    expect(activeStages(item)).toEqual(['embed', 'understand'])
  })

  it('parks ai jobs without burning attempts and shows WAITING_FOR_AI', () => {
    const item = h.item({ type: 'image' })
    h.queue.enqueueInitial(item)
    h.state.applyResult(claimStage(item, 'thumbnail'), { outcome: 'ok' })
    const understand = claimStage(item, 'understand')
    h.state.applyEntry(understand)
    h.state.applyPark(understand, '2026-09-03T10:05:00.000Z')
    expect(status(item)).toBe('WAITING_FOR_AI')
    expect(h.repos.jobs.get(understand.id)).toMatchObject({
      status: 'queued',
      attempts: 0,
      runAfter: '2026-09-03T10:05:00.000Z'
    })
  })

  it('cancels jobs whose item was trashed instead of writing to it', () => {
    const item = h.item({ type: 'text' })
    h.queue.enqueueInitial(item)
    const extract = claimStage(item, 'extract')
    h.repos.items.setDeleted([item.id], h.clock.nowIso())
    expect(h.state.applyEntry(extract).cancelled).toBe(true)
    expect(h.repos.jobs.get(extract.id)?.status).toBe('cancelled')
    const thumb = claimStage(item, 'thumbnail')
    const result = h.state.applyResult(thumb, { outcome: 'ok', item: { title: 'nope' } })
    expect(result.cancelled).toBe(true)
    expect(h.repos.items.get(item.id)?.title).toBe(item.title)
  })

  it('notes settle on index (last stage) without understanding', () => {
    const note = h.item({ type: 'note' })
    h.queue.enqueueInitial(note)
    h.state.applyResult(claimStage(note, 'index'), { outcome: 'ok' })
    expect(status(note)).toBe('READY')
    h.state.applyResult(claimStage(note, 'embed'), { outcome: 'ok' })
    expect(status(note)).toBe('READY')
  })

  it('follow-up stages from a patch are enqueued', () => {
    const item = h.item({ type: 'url', url: 'https://a.b/x.pdf' })
    h.queue.enqueueInitial(item)
    h.state.applyResult(claimStage(item, 'extract'), { outcome: 'ok', followUp: ['thumbnail'] })
    expect(activeStages(item)).toEqual(['snapshot', 'thumbnail'])
  })

  describe('batch gate', () => {
    const indexBoth = (a: Item, b: Item): void => {
      for (const item of [a, b]) {
        h.state.applyResult(claimStage(item, 'thumbnail'), { outcome: 'ok' })
        h.state.applyResult(claimStage(item, 'understand'), { outcome: 'ok' })
      }
    }

    it('enqueues one organize_batch job 90 s after the first indexed sibling, released when all are indexed', () => {
      const a = h.item({ type: 'image', captureBatchId: 'batch' })
      const b = h.item({ type: 'image', captureBatchId: 'batch' })
      h.queue.enqueueInitial(a)
      h.queue.enqueueInitial(b)
      indexBoth(a, b)
      const start = h.clock.nowIso()
      const r1 = h.state.applyResult(claimStage(a, 'index'), { outcome: 'ok' })
      expect(r1.enqueued.map((j) => j.stage)).toEqual(['organize_batch'])
      const gate = h.repos.jobs.activeForBatch('batch', 'organize_batch')
      expect(gate?.itemId).toBeNull()
      expect(gate?.runAfter).toBe(new Date(Date.parse(start) + LIMITS.batchGateMs).toISOString())
      expect(h.repos.jobs.activeForItem(a.id).map((j) => j.stage)).not.toContain('relate')

      h.clock.advance(10_000)
      const r2 = h.state.applyResult(claimStage(b, 'index'), { outcome: 'ok' })
      expect(r2.enqueued).toEqual([])
      expect(h.repos.jobs.activeForBatch('batch', 'organize_batch')?.runAfter).toBe(h.clock.nowIso())
      expect(h.repos.jobs.claim('ai', h.clock.nowIso())?.stage).toBe('organize_batch')
    })

    it('organize_batch completion settles the indexed siblings; a late sibling gets relate', () => {
      const a = h.item({ type: 'image', captureBatchId: 'batch' })
      const b = h.item({ type: 'image', captureBatchId: 'batch' })
      const late = h.item({ type: 'image', captureBatchId: 'batch' })
      for (const i of [a, b, late]) h.queue.enqueueInitial(i)
      indexBoth(a, b)
      h.state.applyResult(claimStage(a, 'index'), { outcome: 'ok' })
      h.state.applyResult(claimStage(b, 'index'), { outcome: 'ok' })
      h.clock.advance(LIMITS.batchGateMs)
      const batchJob = h.repos.jobs.claim('ai', h.clock.nowIso())
      expect(batchJob?.stage).toBe('organize_batch')
      const result = h.state.applyResult(batchJob as Job, { outcome: 'ok' })
      expect(result.itemIds.sort()).toEqual([a.id, b.id].sort())
      expect(status(a)).toBe('READY')
      expect(status(b)).toBe('READY')
      expect(status(late)).toBe('CAPTURED')
      h.state.applyResult(claimStage(late, 'thumbnail'), { outcome: 'ok' })
      h.state.applyResult(claimStage(late, 'understand'), { outcome: 'ok' })
      const r = h.state.applyResult(claimStage(late, 'index'), { outcome: 'ok' })
      expect(r.enqueued.map((j) => j.stage)).toEqual(['relate'])
    })

    it('a single item in a batch of one just gets relate', () => {
      const a = h.item({ type: 'image', captureBatchId: 'solo' })
      h.queue.enqueueInitial(a)
      h.state.applyResult(claimStage(a, 'thumbnail'), { outcome: 'ok' })
      h.state.applyResult(claimStage(a, 'understand'), { outcome: 'ok' })
      expect(h.state.applyResult(claimStage(a, 'index'), { outcome: 'ok' }).enqueued.map((j) => j.stage)).toEqual([
        'relate'
      ])
    })
  })
})
