import { LIMITS } from '../../shared/constants'
import type { Job, Lane, Stage } from '../../shared/types'
import { isKaError } from '../core/errors'
import type { Clock, EventBus, Logger, Paths, StageContext, StageDefinition, StageDeps } from '../ports'
import type { Db } from '../storage/db'
import type { Repositories } from '../storage/repositories'
import { LANE_CAPACITY } from './graph'
import type { Queue } from './queue'
import type { StateApplier, TransitionResult } from './state'

/** Timer functions, injectable for tests. */
export interface SchedulerTimer {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export interface SchedulerDeps {
  db: Db
  repos: Repositories
  queue: Queue
  state: StateApplier
  stages: readonly StageDefinition[]
  deps: StageDeps
  paths: Paths
  logger: Logger
  clock: Clock
  events: EventBus
  /** Lane concurrency override (default `LIMITS.lanes`). */
  lanes?: Partial<Record<Lane, number>>
  /** Poll interval in ms (default 1000). */
  pollMs?: number
  timer?: SchedulerTimer
  /** How long a parked ai job waits before another attempt (default 5 min). */
  aiRetryMs?: number
}

/** The job scheduler: lanes, priority, backoff, cancellation, batch gate. */
export interface Scheduler {
  /** Crash recovery, then start polling. */
  start(): void
  /** Stop polling and abort running stages. Resolves once running stages have unwound. */
  stop(): Promise<void>
  /** Claim and run whatever is due right now (tests call this directly). */
  tick(): Promise<void>
  /** Ask for a tick soon (after an enqueue). */
  wake(): void
  /** Number of stages currently running (all lanes). */
  running(): number
  /** Stop claiming ai-lane jobs; queued ai jobs show `WAITING_FOR_AI`. */
  pauseAi(): void
  /** Resume the ai lane and release parked jobs. */
  resumeAi(): void
  /** True while the ai lane is paused. */
  aiPaused(): boolean
}

const DEFAULT_TIMER: SchedulerTimer = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>)
}

/** Product-voice note left on a job when its stage is not part of this build yet. */
export const NOT_AVAILABLE_MESSAGE = 'Skipped for now.'

export function createScheduler(deps: SchedulerDeps): Scheduler {
  const { db, repos, queue, state, paths, logger, clock, events } = deps
  const timer = deps.timer ?? DEFAULT_TIMER
  const pollMs = deps.pollMs ?? 1000
  const aiRetryMs = deps.aiRetryMs ?? 5 * 60_000
  const capacity: Record<Lane, number> = { ...LANE_CAPACITY, ...(deps.lanes ?? {}) }
  const stageByName = new Map<Stage, StageDefinition>(deps.stages.map((s) => [s.name, s]))

  const running = new Map<string, { job: Job; controller: AbortController }>()
  const perLane: Record<Lane, number> = { io: 0, embed: 0, ai: 0 }
  let started = false
  let stopping = false
  let ticking = false
  let tickAgain = false
  let pollHandle: unknown = null
  let aiPausedFlag = false
  let aiResumeHandle: unknown = null

  /** Re-open the ai lane after the retry window instead of waiting for a settings change. */
  const scheduleAiResume = (): void => {
    if (aiResumeHandle !== null) return
    aiResumeHandle = timer.setTimeout(() => {
      aiResumeHandle = null
      if (!stopping) scheduler.resumeAi()
    }, aiRetryMs)
  }

  const emitResult = (result: TransitionResult): void => {
    events.emit('job.progress', result.progress)
    if (result.itemIds.length > 0) {
      const summaries = repos.items.summaries(repos.items.getMany(result.itemIds))
      events.emit('item.updated', { reason: 'updated', ids: result.itemIds, summaries })
    }
  }

  const schedulePoll = (ms: number): void => {
    if (!started || stopping) return
    if (pollHandle !== null) timer.clearTimeout(pollHandle)
    pollHandle = timer.setTimeout(() => {
      pollHandle = null
      void tick()
    }, ms)
  }

  const runJob = async (job: Job, item: StageContext['item']): Promise<void> => {
    const stage = stageByName.get(job.stage)
    const controller = new AbortController()
    running.set(job.id, { job, controller })
    perLane[job.lane] += 1
    const log = logger.child({ jobId: job.id, stage: job.stage, itemId: job.itemId, batchId: job.batchId })
    const timeout = timer.setTimeout(() => controller.abort(new Error('timeout')), stage?.timeoutMs ?? 60_000)
    const startedAt = Date.now()
    let result: TransitionResult | null = null
    try {
      if (!stage) throw new Error(`No stage registered for "${job.stage}"`)
      const ctx: StageContext = {
        ...(job.itemId ? { itemId: job.itemId } : {}),
        ...(job.batchId ? { batchId: job.batchId } : {}),
        ...(item ? { item } : {}),
        paths,
        logger: log,
        clock,
        signal: controller.signal,
        deps: deps.deps
      }
      const patch = await stage.run(ctx)
      result = state.applyResult(job, patch)
      log.debug('stage finished', { outcome: patch.outcome, ms: Date.now() - startedAt })
    } catch (error) {
      result = handleError(job, error, log)
    } finally {
      timer.clearTimeout(timeout)
      running.delete(job.id)
      perLane[job.lane] -= 1
    }
    if (result) emitResult(result)
    if (!stopping) wake()
  }

  const handleError = (job: Job, error: unknown, log: Logger): TransitionResult | null => {
    const message = error instanceof Error ? error.message : String(error)
    if (stopping) {
      // Left `running`; boot-time crash reset re-queues it.
      log.info('stage interrupted by shutdown')
      return null
    }
    if (isKaError(error)) {
      if (error.code === 'NOT_IMPLEMENTED') {
        log.debug('stage not implemented in this build; skipping', { message })
        return state.applyResult(job, { outcome: 'partial', message: NOT_AVAILABLE_MESSAGE })
      }
      if (error.code === 'AI_NOT_CONFIGURED' || error.code === 'AI_UNAVAILABLE' || error.code === 'OFFLINE') {
        log.info('ai unavailable; parking job', { code: error.code })
        aiPausedFlag = true
        if (error.code !== 'AI_NOT_CONFIGURED') scheduleAiResume()
        return state.applyPark(job, new Date(clock.now().getTime() + aiRetryMs).toISOString())
      }
      if (error.code === 'CANCELLED') {
        const still = repos.jobs.get(job.id)
        if (still?.status === 'running') return state.applyRetry(job, message)
        return null
      }
    }
    if (job.attempts < LIMITS.maxAttempts) {
      log.warn('stage failed; will retry', { error, attempts: job.attempts })
      return state.applyRetry(job, message)
    }
    log.error('stage failed; giving up', { error, attempts: job.attempts })
    return state.applyFailure(job, message)
  }

  type Claim = { job: Job; item: StageContext['item'] } | 'cancelled' | null

  const claimOne = (lane: Lane): Claim =>
    db.transaction((): Claim => {
      const job = repos.jobs.claim(lane, clock.nowIso())
      if (!job) return null
      const entry = state.applyEntry(job)
      if (entry.cancelled) return 'cancelled'
      if (entry.progress) {
        db.afterCommit(() => {
          events.emit('job.progress', entry.progress as NonNullable<typeof entry.progress>)
          if (entry.item) {
            events.emit('item.updated', {
              reason: 'updated',
              ids: [entry.item.id],
              summaries: repos.items.summaries([entry.item])
            })
          }
        })
      }
      return { job, item: entry.item ?? undefined }
    })

  const tick = async (): Promise<void> => {
    if (ticking) {
      tickAgain = true
      return
    }
    ticking = true
    try {
      do {
        tickAgain = false
        for (const lane of ['io', 'embed', 'ai'] as const) {
          if (lane === 'ai' && aiPausedFlag) continue
          while (!stopping && perLane[lane] < capacity[lane]) {
            const claimed = claimOne(lane)
            if (claimed === null) break
            if (claimed === 'cancelled') continue
            void runJob(claimed.job, claimed.item)
          }
        }
      } while (tickAgain)
    } finally {
      ticking = false
    }
    if (started && !stopping) schedulePoll(pollMs)
  }

  const wake = (): void => {
    if (!started || stopping) return
    schedulePoll(0)
  }

  queue.onEnqueue(wake)

  const scheduler: Scheduler = {
    start() {
      if (started) return
      started = true
      stopping = false
      const reset = queue.resetCrashed()
      if (reset.requeued + reset.failed > 0) logger.info('crash recovery', reset)
      void tick()
    },
    async stop() {
      stopping = true
      if (pollHandle !== null) {
        timer.clearTimeout(pollHandle)
        pollHandle = null
      }
      for (const { controller } of running.values()) controller.abort(new Error('shutdown'))
      const deadline = Date.now() + 5_000
      while (running.size > 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 25))
      }
      started = false
    },
    tick,
    wake,
    running: () => running.size,
    pauseAi() {
      if (aiPausedFlag) return
      aiPausedFlag = true
      const touched = db.transaction(() => {
        const ids: string[] = []
        for (const p of repos.jobs.activeProgress()) {
          if (!p.itemId || p.jobStatus !== 'queued') continue
          const job = repos.jobs.activeForItem(p.itemId).find((j) => j.lane === 'ai' && j.status === 'queued')
          if (!job) continue
          const parked = state.applyPark(job, null)
          ids.push(...parked.itemIds)
        }
        return ids
      })
      if (touched.length > 0) {
        events.emit('item.updated', {
          reason: 'updated',
          ids: touched,
          summaries: repos.items.summaries(repos.items.getMany(touched))
        })
      }
    },
    resumeAi() {
      if (aiResumeHandle !== null) {
        timer.clearTimeout(aiResumeHandle)
        aiResumeHandle = null
      }
      if (!aiPausedFlag) return
      aiPausedFlag = false
      db.transaction(() => {
        const now = clock.nowIso()
        for (const p of repos.jobs.activeProgress()) {
          if (p.jobStatus !== 'queued') continue
          const jobsToRelease = p.itemId
            ? repos.jobs.activeForItem(p.itemId).filter((j) => j.lane === 'ai' && j.status === 'queued')
            : p.batchId
              ? [repos.jobs.activeForBatch(p.batchId, p.stage)].filter((j): j is Job => j !== null && j.lane === 'ai')
              : []
          for (const job of jobsToRelease)
            if (job.runAfter && job.runAfter > now) repos.jobs.setRunAfter(job.id, now, now)
        }
      })
      wake()
    },
    aiPaused: () => aiPausedFlag
  }
  return scheduler
}
