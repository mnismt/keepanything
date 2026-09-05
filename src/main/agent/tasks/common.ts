/** Shared plumbing for the pipeline's AI tasks (understand / relate / organize_batch / consolidate): reading services out of `StageDeps`, one structured call with the failure ladder the stages agree on, and agent-run bookkeeping (`agent_runs` rows + `agent.run` events, never prompts). */
import { COPY } from '../../../shared/constants'
import type { IpcError } from '../../../shared/ipc'
import type { AgentResult, AgentRunDetail, AgentStep, AgentTask, AgentUsage } from '../../../shared/types'
import { generateStructured, STRUCTURED_FAILURE_MESSAGE } from '../../ai'
import type { CollectionService } from '../../core/collection-service'
import { isKaError, KaError } from '../../core/errors'
import { uuid } from '../../core/ids'
import type { ItemService } from '../../core/item-service'
import type { RelationshipService } from '../../core/relationship-service'
import type { Queue } from '../../pipeline/queue'
import type {
  AIProvider,
  ChatRequest,
  Clock,
  EmbeddingProvider,
  EventBus,
  Logger,
  StageContext,
  StageDeps,
  StructuredSchema,
  Usage
} from '../../ports'
import type { RetrievalService } from '../../retrieval'
import type { Repositories } from '../../storage/repositories'

export interface TaskServices {
  repos: Repositories
  ai: AIProvider
  embeddings?: EmbeddingProvider
  retrieval?: RetrievalService
  collections?: CollectionService
  relationships?: RelationshipService
  items?: ItemService
  queue?: Queue
  events?: EventBus
}

/** Read the services a task needs. No repos -> `NOT_IMPLEMENTED` (skipped); no provider -> `AI_NOT_CONFIGURED` (job parks). */
export function taskServices(deps: StageDeps): TaskServices {
  const repos = deps.repos as Repositories | undefined
  if (!repos) throw new KaError('NOT_IMPLEMENTED', 'AI stages need repositories in StageDeps.')
  const ai = typeof deps.ai === 'function' ? (deps.ai as () => AIProvider)() : deps.ai
  if (!ai) throw new KaError('AI_NOT_CONFIGURED', COPY.connectHint)
  const out: TaskServices = { repos, ai }
  if (deps.embeddings) out.embeddings = deps.embeddings
  if (deps.retrieval) out.retrieval = deps.retrieval as RetrievalService
  if (deps.collections) out.collections = deps.collections as CollectionService
  if (deps.relationships) out.relationships = deps.relationships as RelationshipService
  if (deps.items) out.items = deps.items as ItemService
  if (deps.queue) out.queue = deps.queue as Queue
  if (deps.events) out.events = deps.events
  return out
}

export type StructuredFailure = 'schema' | 'truncated'

export type StructuredOutcome<T> =
  | { ok: true; value: T; usage: Usage }
  | { ok: false; failure: StructuredFailure; message: string; usage: Usage }

const ZERO: Usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 }

function addUsage(a: Usage, b: Usage): Usage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: (a.totalTokens ?? 0) + (b.totalTokens ?? b.promptTokens + b.completionTokens),
    latencyMs: a.latencyMs + b.latencyMs
  }
}

/**
 * One structured call with the stage ladder: provider errors (`AI_NOT_CONFIGURED`, `AI_UNAVAILABLE`
 * from the network, `OFFLINE`, `CANCELLED`) propagate so the scheduler parks/retries; a schema
 * failure after the provider's own retry is returned as `failure: 'schema'`; a truncated answer
 * rebuilds the request with half the text budget once, then returns `failure: 'truncated'`.
 */
export async function structuredCall<T>(
  provider: AIProvider,
  schema: StructuredSchema<T>,
  build: (textBudget: number) => ChatRequest,
  opts: { textBudget: number; minBudget?: number; logger: Logger }
): Promise<StructuredOutcome<T>> {
  let budget = opts.textBudget
  let usage = ZERO
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await generateStructured(provider, schema, build(budget))
      return { ok: true, value: result.value, usage: addUsage(usage, result.usage) }
    } catch (error) {
      if (!isKaError(error) || error.message !== STRUCTURED_FAILURE_MESSAGE) throw error
      const details = (error.details ?? {}) as { lastError?: string; usage?: Usage }
      if (details.usage) usage = addUsage(usage, details.usage)
      const truncated = /cut off/i.test(details.lastError ?? '')
      if (truncated && attempt === 0) {
        budget = Math.max(opts.minBudget ?? 1_000, Math.floor(budget / 2))
        opts.logger.warn('ai.task.truncated; retrying with a smaller text budget', { budget })
        continue
      }
      return {
        ok: false,
        failure: truncated ? 'truncated' : 'schema',
        message: details.lastError ?? error.message,
        usage
      }
    }
  }
  return { ok: false, failure: 'truncated', message: 'The response was cut off.', usage }
}

/** Usage summed into the persisted shape. */
export function toAgentUsage(usage: Usage, calls: number): AgentUsage {
  return {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    calls,
    latencyMs: usage.latencyMs
  }
}

export interface TaskRun {
  id: string
  /** Append a step (label in product voice) and push it to the UI. */
  step(step: Omit<AgentStep, 'n' | 'durationMs'> & { durationMs?: number }): void
  succeed(result: AgentResult, usage: AgentUsage | null): void
  fail(message: string, usage?: AgentUsage | null): void
}

/** Start a run row for a pipeline task and emit `agent.run` running. */
export function startTaskRun(
  services: Pick<TaskServices, 'repos' | 'events' | 'ai'>,
  clock: Clock,
  input: { task: AgentTask; itemId?: string | null; batchId?: string | null }
): TaskRun {
  const id = uuid()
  const steps: AgentStep[] = []
  const startedAt = clock.nowIso()
  const run: AgentRunDetail = {
    id,
    itemId: input.itemId ?? null,
    batchId: input.batchId ?? null,
    task: input.task,
    status: 'running',
    model: services.ai.model,
    startedAt,
    completedAt: null,
    stepCount: 0,
    error: null,
    steps,
    undoable: false,
    usage: null,
    result: null
  }
  services.repos.agentRuns.insert(run)
  const emit = (patch: { step?: AgentStep; result?: AgentResult; undoable?: boolean; error?: IpcError }): void => {
    services.events?.emit('agent.run', {
      runId: id,
      task: input.task,
      status: run.status,
      ...(input.itemId ? { itemId: input.itemId } : {}),
      ...(input.batchId ? { batchId: input.batchId } : {}),
      ...patch
    })
  }
  emit({})
  return {
    id,
    step(step) {
      const full: AgentStep = { ...step, n: steps.length + 1, durationMs: step.durationMs ?? 0 }
      steps.push(full)
      services.repos.agentRuns.update(id, { steps })
      emit({ step: full })
    },
    succeed(result, usage) {
      run.status = 'succeeded'
      services.repos.agentRuns.update(id, { status: 'succeeded', completedAt: clock.nowIso(), result, usage, steps })
      // Undo is per run: the toast offers it only when the run actually wrote audited changes.
      const undoable = services.repos.audit.forRun(id).some((e) => !e.undoneAt)
      emit({ result, undoable })
    },
    fail(message, usage = null) {
      run.status = 'failed'
      services.repos.agentRuns.update(id, {
        status: 'failed',
        completedAt: clock.nowIso(),
        error: message,
        usage,
        steps
      })
      emit({ error: { code: 'AI_UNAVAILABLE', message } })
    }
  }
}

/** The item a per-item stage runs on (throws when the scheduler gave us none). */
export function requireItem(ctx: StageContext): NonNullable<StageContext['item']> {
  if (!ctx.item) throw new Error(`${ctx.itemId ?? 'unknown'}: stage needs an item`)
  return ctx.item
}
