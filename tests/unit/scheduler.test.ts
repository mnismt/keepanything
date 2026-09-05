import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KaError } from '../../src/main/core/errors'
import { silentLogger } from '../../src/main/lib/logger'
import {
  createScheduler,
  NOT_AVAILABLE_MESSAGE,
  type Scheduler,
  type SchedulerTimer
} from '../../src/main/pipeline/scheduler'
import { STAGES } from '../../src/main/pipeline/stages'
import type { StageDefinition, StagePatch } from '../../src/main/ports'
import { LIMITS } from '../../src/shared/constants'
import type { Stage } from '../../src/shared/types'
import { createHarness, type Harness } from './helpers/harness'

let h: Harness

/** Timer that never fires: tests drive the scheduler with `tick()` and the manual clock. */
const frozenTimer: SchedulerTimer = { setTimeout: () => ({}), clearTimeout: () => {} }

interface Deferred {
  stage: Stage
  resolve(patch: StagePatch): void
  reject(error: unknown): void
}

/** Stage bodies that block until the test releases them. */
function blockingStages(): { stages: StageDefinition[]; pending: Deferred[] } {
  const pending: Deferred[] = []
  const stages = STAGES.map((s) => ({
    ...s,
    run: (ctx: { signal: AbortSignal }) =>
      new Promise<StagePatch>((resolve, reject) => {
        pending.push({ stage: s.name, resolve, reject })
        ctx.signal.addEventListener('abort', () => reject(new KaError('CANCELLED', 'aborted')), { once: true })
      })
  }))
  return { stages, pending }
}

function scheduler(stages: readonly StageDefinition[]): Scheduler {
  return createScheduler({
    db: h.db,
    repos: h.repos,
    queue: h.queue,
    state: h.state,
    stages,
    deps: {},
    paths: h.paths,
    logger: silentLogger,
    clock: h.clock,
    events: h.events,
    timer: frozenTimer
  })
}

const settle = async (s: Scheduler): Promise<void> => {
  await vi.waitFor(() => expect(s.running()).toBe(0))
}

beforeEach(() => {
  h = createHarness()
})
afterEach(() => h.close())

describe('scheduler', () => {
  it('respects lane concurrency (io=2, embed=1, ai=1) and priority', async () => {
    const { stages, pending } = blockingStages()
    const s = scheduler(stages)
    for (let i = 0; i < 3; i += 1) h.queue.enqueueInitial(h.item({ type: 'text' })) // 3× extract + 3× thumbnail (io)
    const imageA = h.item({ type: 'image' })
    const imageB = h.item({ type: 'image' })
    for (const image of [imageA, imageB]) {
      h.queue.enqueueStages(image, ['understand']) // ai lane
      h.queue.enqueueStages(image, ['embed']) // embed lane
    }
    await s.tick()
    expect(s.running()).toBe(LIMITS.lanes.io + LIMITS.lanes.embed + LIMITS.lanes.ai)
    const running = pending.map((p) => p.stage)
    expect(running.filter((st) => st === 'extract')).toHaveLength(2) // extract (25) outranks thumbnail (15)
    expect(running.filter((st) => st === 'understand')).toHaveLength(1)
    expect(running.filter((st) => st === 'embed')).toHaveLength(1)
    const imageStatuses = [imageA, imageB].map((i) => h.repos.items.get(i.id)?.processingStatus).sort()
    expect(imageStatuses).toEqual(['CAPTURED', 'UNDERSTANDING']) // exactly one understand job is running

    for (const p of pending.splice(0)) p.resolve({ outcome: 'ok' })
    await settle(s)
    await s.tick()
    expect(s.running()).toBeGreaterThan(0)
    for (const p of pending.splice(0)) p.resolve({ outcome: 'ok' })
    await settle(s)
    await s.stop()
  })

  it('runs a captured text item through the honest stubs and settles it as PARTIAL', async () => {
    const s = scheduler(STAGES)
    const item = h.item({ type: 'text', title: 'Note' })
    h.queue.enqueueInitial(item)
    for (let round = 0; round < 8 && h.repos.jobs.activeForItem(item.id).length > 0; round += 1) {
      await s.tick()
      await settle(s)
    }
    const final = h.repos.items.get(item.id)
    expect(final?.processingStatus).toBe('PARTIAL')
    expect(final?.processingError).toBeNull()
    expect(h.repos.jobs.activeForItem(item.id)).toEqual([])
    const stagesRun = [...h.repos.jobs.latestPerStage(item.id).values()].map((j) => `${j.stage}:${j.status}`).sort()
    expect(stagesRun).toEqual([
      'embed:done',
      'extract:done',
      'index:done',
      'relate:done',
      'thumbnail:done',
      'understand:done'
    ])
    const progress = h.eventsNamed('job.progress')
    expect(progress.some((p) => p.message === NOT_AVAILABLE_MESSAGE)).toBe(true)
    expect(h.eventsNamed('item.indexed').map((e) => e.itemId)).toContain(item.id)
    await s.stop()
  })

  it('holds the batch gate until the clock passes run_after', async () => {
    const { stages, pending } = blockingStages()
    const s = scheduler(stages)
    const a = h.item({ type: 'image', captureBatchId: 'b' })
    const b = h.item({ type: 'image', captureBatchId: 'b' })
    h.queue.enqueueInitial(a)
    h.queue.enqueueInitial(b)
    const drive = async (): Promise<void> => {
      await s.tick()
      for (const p of pending.splice(0)) p.resolve({ outcome: 'ok' })
      await settle(s)
    }
    // Drive thumbnails → understand → index until the first sibling's index opens the gate.
    for (let i = 0; i < 10 && !h.repos.jobs.activeForBatch('b', 'organize_batch'); i += 1) await drive()
    const gate = h.repos.jobs.activeForBatch('b', 'organize_batch')
    expect(gate?.status).toBe('queued')
    expect(gate?.runAfter).toBe(new Date(h.clock.now().getTime() + LIMITS.batchGateMs).toISOString())

    // The other sibling is still indexing: the ai lane must not claim organize_batch yet.
    await s.tick()
    expect(pending.map((p) => p.stage)).not.toContain('organize_batch')
    // 90 s later the gate opens regardless of the straggler.
    h.clock.advance(LIMITS.batchGateMs)
    await s.tick()
    expect(pending.map((p) => p.stage)).toContain('organize_batch')
    // Finish the batch first, then the straggler's index: it falls back to a single-item relate.
    pending.sort((x, y) => (x.stage === 'organize_batch' ? -1 : y.stage === 'organize_batch' ? 1 : 0))
    for (const p of pending.splice(0)) p.resolve({ outcome: 'ok' })
    await settle(s)
    const statuses = [a, b].map((i) => h.repos.items.get(i.id)?.processingStatus).sort()
    expect(statuses).toEqual(['READY', 'RELATING'])
    const straggler =
      statuses[1] === 'RELATING'
        ? [a, b].find((i) => h.repos.items.get(i.id)?.processingStatus === 'RELATING')
        : undefined
    expect(h.repos.jobs.activeForItem(straggler?.id ?? '').map((j) => j.stage)).toEqual(['relate'])
    await s.stop()
  })

  it('retries thrown errors with backoff and parks when AI is unavailable', async () => {
    const { stages, pending } = blockingStages()
    const s = scheduler(stages)
    const item = h.item({ type: 'image' })
    h.queue.enqueueStages(item, ['understand'])
    await s.tick()
    pending.splice(0)[0]?.reject(new Error('502 from provider'))
    await settle(s)
    const job = h.repos.jobs.activeForItem(item.id)[0]
    expect(job).toMatchObject({ status: 'queued', attempts: 1, lastError: '502 from provider' })
    expect(job?.runAfter).toBe(new Date(h.clock.now().getTime() + LIMITS.retryBackoffMs[0]).toISOString())
    expect(h.repos.items.get(item.id)?.processingStatus).toBe('AI_FAILED')

    await s.tick()
    expect(pending).toHaveLength(0) // backoff not elapsed
    h.clock.advance(LIMITS.retryBackoffMs[0])
    await s.tick()
    pending.splice(0)[0]?.reject(new KaError('AI_NOT_CONFIGURED', 'no key'))
    await settle(s)
    expect(s.aiPaused()).toBe(true)
    expect(h.repos.items.get(item.id)?.processingStatus).toBe('WAITING_FOR_AI')
    expect(h.repos.jobs.activeForItem(item.id)[0]).toMatchObject({ status: 'queued', attempts: 1 })

    await s.tick()
    expect(pending).toHaveLength(0) // ai lane paused
    s.resumeAi()
    await s.tick()
    expect(pending.map((p) => p.stage)).toEqual(['understand'])
    pending.splice(0)[0]?.resolve({ outcome: 'ok', item: { understanding: 'A screenshot' } })
    await settle(s)
    expect(h.repos.items.get(item.id)?.processingStatus).toBe('RELATING')
    await s.stop()
  })

  it('pauseAi parks queued ai jobs so their items read WAITING_FOR_AI', async () => {
    const s = scheduler(STAGES)
    const item = h.item({ type: 'image', processingStatus: 'EXTRACTED' })
    h.queue.enqueueStages(item, ['understand'])
    s.pauseAi()
    expect(h.repos.items.get(item.id)?.processingStatus).toBe('WAITING_FOR_AI')
    await s.tick()
    expect(s.running()).toBe(0)
    await s.stop()
  })

  it('re-opens the ai lane by itself after a transient provider outage', async () => {
    const scheduled: Array<{ fn: () => void; ms: number }> = []
    const capturingTimer: SchedulerTimer = {
      setTimeout: (fn, ms) => {
        scheduled.push({ fn, ms })
        return {}
      },
      clearTimeout: () => {}
    }
    const { stages, pending } = blockingStages()
    const s = createScheduler({
      db: h.db,
      repos: h.repos,
      queue: h.queue,
      state: h.state,
      stages,
      deps: {},
      paths: h.paths,
      logger: silentLogger,
      clock: h.clock,
      events: h.events,
      timer: capturingTimer,
      aiRetryMs: 1234
    })
    const item = h.item({ type: 'image' })
    h.queue.enqueueStages(item, ['understand'])
    await s.tick()
    pending.splice(0)[0]?.reject(new KaError('AI_UNAVAILABLE', 'HTTP 429'))
    await settle(s)
    expect(s.aiPaused()).toBe(true)
    expect(h.repos.items.get(item.id)?.processingStatus).toBe('WAITING_FOR_AI')
    const resume = scheduled.filter((t) => t.ms === 1234)
    expect(resume).toHaveLength(1)

    await s.tick()
    expect(pending).toHaveLength(0) // still paused until the retry window elapses
    h.clock.advance(1234)
    resume[0]?.fn()
    expect(s.aiPaused()).toBe(false)
    await s.tick()
    expect(pending.map((p) => p.stage)).toEqual(['understand'])
    await s.stop()
  })

  it('start() re-queues jobs left running by a crash', async () => {
    const item = h.item({ type: 'text' })
    h.queue.enqueueStages(item, ['extract'])
    h.repos.jobs.claim('io', h.clock.nowIso())
    const { stages } = blockingStages()
    const s = scheduler(stages)
    s.start()
    expect(h.repos.jobs.activeForItem(item.id)[0]?.status).toBe('running') // claimed again by the first tick
    await s.stop()
  })
})
