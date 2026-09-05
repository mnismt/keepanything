import { LIMITS } from '../../shared/constants'
import { isTerminal, next, STICKY_STATUSES, stageEntryStatus } from '../../shared/status'
import type { Item, Job, JobProgress, ProcessingStatus, Stage } from '../../shared/types'
import type { Clock, Logger, StagePatch, StagePatchableColumn } from '../ports'
import type { Db } from '../storage/db'
import type { Repositories } from '../storage/repositories'
import { isLastStage, nextStages, STAGE_LANE } from './graph'
import type { Queue } from './queue'

/** Columns a stage may write (mirrors `StagePatchableColumn`). Anything else in a patch is dropped. */
const PATCHABLE: ReadonlySet<string> = new Set<StagePatchableColumn>([
  'title',
  'subtype',
  'kind',
  'url',
  'canonicalUrl',
  'domain',
  'mimeType',
  'size',
  'contentHash',
  'width',
  'height',
  'durationMs',
  'pageCount',
  'managedPath',
  'processingError',
  'understanding',
  'whyUseful',
  'topics',
  'entities',
  'visionText',
  'retrievalHints',
  'aiConfidence',
  'extractedText',
  'excerpt',
  'thumbnailPath',
  'snapshotPath',
  'faviconPath',
  'dominantColor',
  'mediaVersion'
])

export interface TransitionResult {
  /** Items whose row changed (summaries should be pushed). */
  itemIds: string[]
  /** `jobs:progress` payload for the job. */
  progress: JobProgress
  /** Items that reached `READY`/`PARTIAL` in this transition. */
  settledIds: string[]
  /** Items whose `index` stage finished. */
  indexedIds: string[]
  enqueued: Job[]
  /** True when the job was dropped because its item is gone. */
  cancelled: boolean
}

/** Applies stage results to the database, one transaction each. */
export interface StateApplier {
  /** Set the item's running status. Cancels the job when the item is trashed/gone. */
  applyEntry(job: Job): { item: Item | null; progress: JobProgress | null; cancelled: boolean }
  /** Item columns + metadata + status + job done/failed + next jobs. */
  applyResult(job: Job, patch: StagePatch): TransitionResult
  /** Stage threw and attempts remain: failed status now, job re-queued with backoff. */
  applyRetry(job: Job, error: string): TransitionResult
  /** Stage threw and attempts are exhausted: job failed; io/embed lanes still unlock the graph. */
  applyFailure(job: Job, error: string): TransitionResult
  /** Park the job without burning an attempt, item shows `WAITING_FOR_AI`. */
  applyPark(job: Job, runAfter: string | null): TransitionResult
  /** Backoff delay for the given attempt count (1-based). */
  backoffMs(attempts: number): number
}

export interface StateDeps {
  db: Db
  repos: Repositories
  queue: Queue
  clock: Clock
  logger?: Logger
}

export function createStateApplier(deps: StateDeps): StateApplier {
  const { db, repos, queue, clock } = deps
  const { items, jobs } = repos

  const progressOf = (
    job: Job,
    jobStatus: JobProgress['jobStatus'],
    status: ProcessingStatus | null,
    message?: string
  ): JobProgress => {
    const p: JobProgress = {
      itemId: job.itemId,
      batchId: job.batchId,
      processingStatus: status,
      stage: job.stage,
      jobStatus,
      attempts: job.attempts
    }
    if (message) p.message = message
    return p
  }

  const empty = (
    job: Job,
    jobStatus: JobProgress['jobStatus'],
    status: ProcessingStatus | null,
    cancelled = false
  ): TransitionResult => ({
    itemIds: [],
    progress: progressOf(job, jobStatus, status),
    settledIds: [],
    indexedIds: [],
    enqueued: [],
    cancelled
  })

  const backoffMs = (attempts: number): number => {
    const table = LIMITS.retryBackoffMs
    const idx = Math.min(Math.max(attempts, 1), table.length) - 1
    return table[idx] ?? table[table.length - 1] ?? 60_000
  }

  const liveItem = (job: Job): Item | null => {
    if (!job.itemId) return null
    const item = items.get(job.itemId)
    return item && !item.deletedAt ? item : null
  }

  /** Siblings that are at the relate step (their `index` finished). */
  const indexedSiblings = (batchId: string): Item[] =>
    items.siblings(batchId).filter((s) => s.type !== 'note' && jobs.finishedStages(s.id).has('index'))

  const allSiblingsIndexed = (batchId: string): boolean => {
    const siblings = items.siblings(batchId).filter((s) => s.type !== 'note')
    return siblings.length > 0 && siblings.every((s) => jobs.finishedStages(s.id).has('index'))
  }

  /** `relate` vs one `organize_batch` per capture batch (gate: all indexed or 90 s after the first). */
  const scheduleRelate = (item: Item, now: string, enqueued: Job[]): void => {
    const batchId = item.captureBatchId
    if (!batchId || items.siblings(batchId).length < 2) {
      enqueued.push(...queue.enqueueStages(item, ['relate']))
      return
    }
    const active = jobs.activeForBatch(batchId, 'organize_batch')
    if (active) {
      if (active.status === 'queued' && allSiblingsIndexed(batchId)) jobs.setRunAfter(active.id, now, now)
      return
    }
    if (jobs.latestForBatch(batchId, 'organize_batch')) {
      // The batch was already organized; a late sibling gets the single-item treatment.
      enqueued.push(...queue.enqueueStages(item, ['relate']))
      return
    }
    const gateAt = allSiblingsIndexed(batchId) ? now : new Date(Date.parse(now) + LIMITS.batchGateMs).toISOString()
    const job = queue.enqueue({ itemId: null, batchId, stage: 'organize_batch', runAfter: gateAt })
    if (job) enqueued.push(job)
  }

  const unlockNext = (item: Item, stage: Stage, followUp: Stage[] | undefined, now: string, enqueued: Job[]): void => {
    const finished = jobs.finishedStages(item.id)
    const nexts = new Set<Stage>([...nextStages(item.type, stage, finished), ...(followUp ?? [])])
    for (const s of nexts) {
      if (s === 'relate') scheduleRelate(item, now, enqueued)
      else enqueued.push(...queue.enqueueStages(item, [s]))
    }
  }

  const applyItemTransition = (
    job: Job,
    item: Item,
    outcome: StagePatch['outcome'],
    columns: Partial<Item>,
    metadataPatch: Record<string, unknown> | undefined,
    jobStatus: 'done' | 'failed' | 'queued',
    unlock: boolean,
    followUp: Stage[] | undefined,
    message: string | undefined,
    error: string | null
  ): TransitionResult => {
    const now = clock.nowIso()
    const status = next(item.processingStatus, job.stage, outcome, { isLast: isLastStage(item.type, job.stage) })
    items.update(item.id, { ...columns, processingStatus: status, modifiedAt: now })
    if (metadataPatch && Object.keys(metadataPatch).length > 0) items.patchMetadata(item.id, metadataPatch)
    if (jobStatus === 'queued') {
      jobs.requeue(job.id, new Date(Date.parse(now) + backoffMs(job.attempts)).toISOString(), now, error)
    } else {
      jobs.finish(job.id, jobStatus, now, error)
    }
    const enqueued: Job[] = []
    const updated = { ...item, ...columns, processingStatus: status }
    if (unlock) unlockNext(updated, job.stage, followUp, now, enqueued)
    const settled =
      isTerminal(status) && !isTerminal(item.processingStatus) ? [item.id] : isTerminal(status) ? [item.id] : []
    return {
      itemIds: [item.id],
      progress: progressOf(job, jobStatus === 'queued' ? 'queued' : jobStatus, status, message),
      settledIds: settled,
      indexedIds: job.stage === 'index' && jobStatus === 'done' ? [item.id] : [],
      enqueued,
      cancelled: false
    }
  }

  const applyBatchTransition = (
    job: Job,
    outcome: StagePatch['outcome'],
    jobStatus: 'done' | 'failed' | 'queued',
    error: string | null,
    message?: string
  ): TransitionResult => {
    const now = clock.nowIso()
    const touched: string[] = []
    const settled: string[] = []
    if (job.batchId && job.stage === 'organize_batch') {
      for (const sibling of indexedSiblings(job.batchId)) {
        const status = next(sibling.processingStatus, job.stage, outcome)
        if (status !== sibling.processingStatus) {
          items.update(sibling.id, {
            processingStatus: status,
            modifiedAt: now,
            ...(outcome === 'failed' ? { processingError: error } : {})
          })
          touched.push(sibling.id)
          if (isTerminal(status)) settled.push(sibling.id)
        }
      }
    }
    if (jobStatus === 'queued')
      jobs.requeue(job.id, new Date(Date.parse(now) + backoffMs(job.attempts)).toISOString(), now, error)
    else jobs.finish(job.id, jobStatus, now, error)
    return {
      itemIds: touched,
      progress: progressOf(job, jobStatus, null, message),
      settledIds: settled,
      indexedIds: [],
      enqueued: [],
      cancelled: false
    }
  }

  return {
    backoffMs,
    applyEntry(job) {
      return db.transaction(() => {
        if (!job.itemId) return { item: null, progress: progressOf(job, 'running', null), cancelled: false }
        const item = liveItem(job)
        if (!item) {
          jobs.finish(job.id, 'cancelled', clock.nowIso())
          return { item: null, progress: null, cancelled: true }
        }
        const entry = stageEntryStatus(job.stage, item.processingStatus)
        if (entry && entry !== item.processingStatus) {
          items.update(item.id, { processingStatus: entry, modifiedAt: clock.nowIso() })
          item.processingStatus = entry
        }
        return { item, progress: progressOf(job, 'running', item.processingStatus), cancelled: false }
      })
    },
    applyResult(job, patch) {
      return db.transaction(() => {
        if (!job.itemId)
          return applyBatchTransition(
            job,
            patch.outcome,
            patch.outcome === 'failed' ? 'failed' : 'done',
            patch.error ?? null,
            patch.message
          )
        const item = liveItem(job)
        if (!item) {
          jobs.finish(job.id, 'cancelled', clock.nowIso())
          return empty(job, 'cancelled', null, true)
        }
        const columns: Partial<Item> = {}
        for (const [key, value] of Object.entries(patch.item ?? {})) {
          if (PATCHABLE.has(key) && value !== undefined) (columns as Record<string, unknown>)[key] = value
        }
        if (patch.outcome === 'failed') columns.processingError = patch.error ?? patch.message ?? `${job.stage} failed`
        else if (columns.processingError === undefined && STAGE_LANE[job.stage] !== 'io') columns.processingError = null
        const jobStatus = patch.outcome === 'failed' ? 'failed' : 'done'
        // A returned failure is definitive (no retry); the graph continues unless it is an ai stage.
        const unlock = patch.outcome !== 'failed' || STAGE_LANE[job.stage] !== 'ai'
        return applyItemTransition(
          job,
          item,
          patch.outcome,
          columns,
          patch.metadataPatch,
          jobStatus,
          unlock,
          patch.followUp,
          patch.message,
          patch.error ?? null
        )
      })
    },
    applyRetry(job, error) {
      return db.transaction(() => {
        if (!job.itemId) return applyBatchTransition(job, 'failed', 'queued', error)
        const item = liveItem(job)
        if (!item) {
          jobs.finish(job.id, 'cancelled', clock.nowIso())
          return empty(job, 'cancelled', null, true)
        }
        return applyItemTransition(
          job,
          item,
          'failed',
          { processingError: error },
          undefined,
          'queued',
          false,
          undefined,
          undefined,
          error
        )
      })
    },
    applyFailure(job, error) {
      return db.transaction(() => {
        if (!job.itemId) return applyBatchTransition(job, 'failed', 'failed', error)
        const item = liveItem(job)
        if (!item) {
          jobs.finish(job.id, 'cancelled', clock.nowIso())
          return empty(job, 'cancelled', null, true)
        }
        const unlock = STAGE_LANE[job.stage] !== 'ai'
        return applyItemTransition(
          job,
          item,
          'failed',
          { processingError: error },
          undefined,
          'failed',
          unlock,
          undefined,
          undefined,
          error
        )
      })
    },
    applyPark(job, runAfter) {
      return db.transaction(() => {
        const now = clock.nowIso()
        jobs.park(job.id, runAfter, now)
        const item = liveItem(job)
        if (!item) return empty(job, 'queued', null)
        let status = item.processingStatus
        if (!isTerminal(status) && !STICKY_STATUSES.includes(status) && status !== 'WAITING_FOR_AI') {
          status = 'WAITING_FOR_AI'
          items.update(item.id, { processingStatus: status, modifiedAt: now })
        }
        return { ...empty(job, 'queued', status), itemIds: [item.id] }
      })
    }
  }
}
