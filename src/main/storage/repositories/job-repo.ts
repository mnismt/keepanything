import { isProcessingStatus } from '../../../shared/status'
import type { Job, JobProgress, JobStatus, Lane, Stage } from '../../../shared/types'
import type { Db } from '../db'
import { numOr, placeholders, type Row, requireText, text } from './rows'

export function rowToJob(row: Row): Job {
  return {
    id: requireText(row.id, 'id'),
    itemId: text(row.item_id),
    batchId: text(row.batch_id),
    stage: requireText(row.stage, 'stage') as Stage,
    lane: requireText(row.lane, 'lane') as Lane,
    priority: numOr(row.priority, 0),
    status: requireText(row.status, 'status') as JobStatus,
    attempts: numOr(row.attempts, 0),
    runAfter: text(row.run_after),
    lastError: text(row.last_error),
    createdAt: requireText(row.created_at, 'created_at'),
    updatedAt: requireText(row.updated_at, 'updated_at')
  }
}

/** Persisted job queue. The unique partial index keeps one active job per item+stage. */
export interface JobRepo {
  /** Insert; returns null when an active job for the same item+stage already exists. */
  insert(job: Job): Job | null
  get(id: string): Job | null
  /**
   * Atomically pick the highest-priority queued job of `lane` whose `run_after` has passed and mark
   * it running (`attempts + 1`). Wrap in `db.transaction` together with the entry-status update.
   */
  claim(lane: Lane, nowIso: string): Job | null
  /** Terminal update. */
  finish(id: string, status: 'done' | 'failed' | 'cancelled', nowIso: string, lastError?: string | null): void
  /** Back to `queued`, optionally with a `run_after` (backoff / batch gate). */
  requeue(id: string, runAfter: string | null, nowIso: string, lastError?: string | null): void
  /** Change `run_after` of a queued job (release the batch gate). */
  setRunAfter(id: string, runAfter: string | null, nowIso: string): void
  /** Cancel every queued/running job of the items. Returns the cancelled jobs. */
  cancelForItems(itemIds: readonly string[], nowIso: string): Job[]
  /** Drop finished rows of `stages` so `finishedStages` stops treating a re-run stage as done. */
  forgetStages(itemId: string, stages: readonly Stage[]): void
  /** `running` -> `queued` when `attempts < maxAttempts`, else `failed 'crashed'`. */
  resetRunning(maxAttempts: number, nowIso: string): { requeued: number; failed: number }
  /** Active (queued|running) jobs of one item. */
  activeForItem(itemId: string): Job[]
  /** Active batch-level job (item_id NULL) for a batch and stage. */
  activeForBatch(batchId: string, stage: Stage): Job | null
  /** Most recent batch-level job of any status for a batch and stage. */
  latestForBatch(batchId: string, stage: Stage): Job | null
  /** Most recent job per stage for the item (any status). */
  latestPerStage(itemId: string): Map<Stage, Job>
  /** Stages whose most recent job finished (done or failed). Re-enqueued stages count as unfinished. */
  finishedStages(itemId: string): Set<Stage>
  /** Park an ai job without burning an attempt (no key / offline). */
  park(id: string, runAfter: string | null, nowIso: string): void
  /** Every active job joined with the item's current status, for `jobs:status`. */
  activeProgress(): JobProgress[]
  countByStatus(status: JobStatus): number
}

export function createJobRepo(db: Db): JobRepo {
  const get = (id: string): Job | null => {
    const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Row | undefined
    return row ? rowToJob(row) : null
  }
  return {
    insert(job) {
      try {
        db.prepare(
          `INSERT INTO jobs (id, item_id, batch_id, stage, lane, priority, status, attempts, run_after, last_error, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          job.id,
          job.itemId,
          job.batchId,
          job.stage,
          job.lane,
          job.priority,
          job.status,
          job.attempts,
          job.runAfter,
          job.lastError,
          job.createdAt,
          job.updatedAt
        )
        return job
      } catch (error) {
        if (error instanceof Error && /UNIQUE constraint failed: jobs\.item_id, jobs\.stage/.test(error.message))
          return null
        throw error
      }
    },
    get,
    claim(lane, nowIso) {
      const row = db
        .prepare(
          `SELECT * FROM jobs WHERE status = 'queued' AND lane = ? AND (run_after IS NULL OR run_after <= ?)
           ORDER BY priority DESC, created_at ASC LIMIT 1`
        )
        .get(lane, nowIso) as Row | undefined
      if (!row) return null
      const job = rowToJob(row)
      db.prepare(
        "UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = 'queued'"
      ).run(nowIso, job.id)
      return get(job.id)
    },
    finish(id, status, nowIso, lastError) {
      db.prepare('UPDATE jobs SET status = ?, updated_at = ?, last_error = coalesce(?, last_error) WHERE id = ?').run(
        status,
        nowIso,
        lastError ?? null,
        id
      )
    },
    requeue(id, runAfter, nowIso, lastError) {
      db.prepare(
        "UPDATE jobs SET status = 'queued', run_after = ?, updated_at = ?, last_error = coalesce(?, last_error) WHERE id = ?"
      ).run(runAfter, nowIso, lastError ?? null, id)
    },
    setRunAfter(id, runAfter, nowIso) {
      db.prepare("UPDATE jobs SET run_after = ?, updated_at = ? WHERE id = ? AND status = 'queued'").run(
        runAfter,
        nowIso,
        id
      )
    },
    cancelForItems(itemIds, nowIso) {
      if (itemIds.length === 0) return []
      const rows = db
        .prepare(
          `SELECT * FROM jobs WHERE item_id IN (${placeholders(itemIds.length)}) AND status IN ('queued', 'running')`
        )
        .all(...itemIds) as Row[]
      const jobs = rows.map(rowToJob)
      for (const job of jobs) {
        db.prepare("UPDATE jobs SET status = 'cancelled', updated_at = ? WHERE id = ?").run(nowIso, job.id)
      }
      return jobs
    },
    forgetStages(itemId, stages) {
      if (stages.length === 0) return
      db.prepare(
        `DELETE FROM jobs WHERE item_id = ? AND stage IN (${placeholders(stages.length)})
         AND status IN ('done', 'failed', 'cancelled')`
      ).run(itemId, ...stages)
    },
    resetRunning(maxAttempts, nowIso) {
      const requeued = db
        .prepare(
          "UPDATE jobs SET status = 'queued', run_after = NULL, updated_at = ? WHERE status = 'running' AND attempts < ?"
        )
        .run(nowIso, maxAttempts).changes
      const failed = db
        .prepare("UPDATE jobs SET status = 'failed', last_error = 'crashed', updated_at = ? WHERE status = 'running'")
        .run(nowIso).changes
      return { requeued: Number(requeued), failed: Number(failed) }
    },
    activeForItem(itemId) {
      return (
        db
          .prepare("SELECT * FROM jobs WHERE item_id = ? AND status IN ('queued', 'running') ORDER BY created_at")
          .all(itemId) as Row[]
      ).map(rowToJob)
    },
    activeForBatch(batchId, stage) {
      const row = db
        .prepare(
          "SELECT * FROM jobs WHERE batch_id = ? AND item_id IS NULL AND stage = ? AND status IN ('queued', 'running') LIMIT 1"
        )
        .get(batchId, stage) as Row | undefined
      return row ? rowToJob(row) : null
    },
    latestForBatch(batchId, stage) {
      const row = db
        .prepare(
          'SELECT * FROM jobs WHERE batch_id = ? AND item_id IS NULL AND stage = ? ORDER BY created_at DESC, rowid DESC LIMIT 1'
        )
        .get(batchId, stage) as Row | undefined
      return row ? rowToJob(row) : null
    },
    latestPerStage(itemId) {
      const rows = db
        .prepare('SELECT * FROM jobs WHERE item_id = ? ORDER BY created_at ASC, rowid ASC')
        .all(itemId) as Row[]
      const latest = new Map<Stage, Job>()
      for (const row of rows) {
        const job = rowToJob(row)
        latest.set(job.stage, job)
      }
      return latest
    },
    finishedStages(itemId) {
      const finished = new Set<Stage>()
      const rows = db
        .prepare('SELECT * FROM jobs WHERE item_id = ? ORDER BY created_at ASC, rowid ASC')
        .all(itemId) as Row[]
      const latest = new Map<Stage, JobStatus>()
      for (const row of rows) latest.set(String(row.stage) as Stage, String(row.status) as JobStatus)
      for (const [stage, status] of latest) if (status === 'done' || status === 'failed') finished.add(stage)
      return finished
    },
    park(id, runAfter, nowIso) {
      db.prepare(
        "UPDATE jobs SET status = 'queued', attempts = max(attempts - 1, 0), run_after = ?, updated_at = ? WHERE id = ?"
      ).run(runAfter, nowIso, id)
    },
    activeProgress() {
      const rows = db
        .prepare(
          `SELECT j.item_id, j.batch_id, j.stage, j.status, j.attempts, i.processing_status
           FROM jobs j LEFT JOIN items i ON i.id = j.item_id
           WHERE j.status IN ('queued', 'running') ORDER BY j.created_at`
        )
        .all() as Row[]
      return rows.map((r) => {
        const status = r.processing_status
        return {
          itemId: text(r.item_id),
          batchId: text(r.batch_id),
          processingStatus: isProcessingStatus(status) ? status : null,
          stage: String(r.stage) as Stage,
          jobStatus: String(r.status) as JobStatus,
          attempts: numOr(r.attempts, 0)
        }
      })
    },
    countByStatus(status) {
      return numOr((db.prepare('SELECT count(*) AS n FROM jobs WHERE status = ?').get(status) as Row).n, 0)
    }
  }
}
