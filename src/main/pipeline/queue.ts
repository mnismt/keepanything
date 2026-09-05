import { LIMITS } from '../../shared/constants'
import type { Item, Job, JobProgress, Stage } from '../../shared/types'
import { type IdGenerator, uuid } from '../core/ids'
import type { Clock } from '../ports'
import type { JobRepo } from '../storage/repositories'
import { initialStages, STAGE_LANE, stagePriority, stagesFrom } from './graph'

export interface EnqueueInput {
  itemId?: string | null
  batchId?: string | null
  stage: Stage
  priority?: number
  runAfter?: string | null
}

/** The job queue over `jobs`. Callers own transactions. */
export interface Queue {
  /** Insert one job; null when an active job for that item+stage already exists. */
  enqueue(input: EnqueueInput): Job | null
  /** Enqueue several stages for one item (child items get lower priority). */
  enqueueStages(item: Item, stages: readonly Stage[]): Job[]
  /** The item's initial stages per the graph. */
  enqueueInitial(item: Item): Job[]
  /** Everything from `from` downstream (or the initial stages when `from` is absent). */
  enqueueFrom(item: Item, from?: Stage): Job[]
  /** Cancel active jobs of the items. */
  cancelForItems(itemIds: readonly string[]): Job[]
  /** Boot recovery of jobs left `running` by a crash. */
  resetCrashed(): { requeued: number; failed: number }
  /** Active jobs as `JobProgress` rows. */
  progress(): JobProgress[]
  /** Called after every successful enqueue (scheduler wake-up). */
  onEnqueue(listener: () => void): () => void
}

export interface QueueDeps {
  jobs: JobRepo
  clock: Clock
  ids?: IdGenerator
}

export function createQueue(deps: QueueDeps): Queue {
  const { jobs, clock } = deps
  const ids = deps.ids ?? uuid
  const listeners = new Set<() => void>()
  const notify = (): void => {
    for (const l of listeners) l()
  }

  const enqueue = (input: EnqueueInput): Job | null => {
    const now = clock.nowIso()
    const job: Job = {
      id: ids(),
      itemId: input.itemId ?? null,
      batchId: input.batchId ?? null,
      stage: input.stage,
      lane: STAGE_LANE[input.stage],
      priority: input.priority ?? stagePriority(input.stage),
      status: 'queued',
      attempts: 0,
      runAfter: input.runAfter ?? null,
      lastError: null,
      createdAt: now,
      updatedAt: now
    }
    const inserted = jobs.insert(job)
    if (inserted) notify()
    return inserted
  }

  const enqueueStages = (item: Item, stages: readonly Stage[]): Job[] => {
    const out: Job[] = []
    for (const stage of stages) {
      const job = enqueue({
        itemId: item.id,
        batchId: item.captureBatchId,
        stage,
        priority: stagePriority(stage, { isChild: item.parentItemId !== null })
      })
      if (job) out.push(job)
    }
    return out
  }

  return {
    enqueue,
    enqueueStages,
    enqueueInitial: (item) => enqueueStages(item, initialStages(item.type)),
    enqueueFrom(item, from) {
      if (!from) return enqueueStages(item, initialStages(item.type))
      // Only `from` itself is enqueued; its downstream stages follow through the graph as it finishes.
      return stagesFrom(item.type, from).length > 0 ? enqueueStages(item, [from]) : []
    },
    cancelForItems: (itemIds) => jobs.cancelForItems(itemIds, clock.nowIso()),
    resetCrashed: () => jobs.resetRunning(LIMITS.maxAttempts, clock.nowIso()),
    progress: () => jobs.activeProgress(),
    onEnqueue(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}
