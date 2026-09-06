import type { AgentStep, AgentUsage } from '../../shared/types'
import {
  AGENT_MAX_TOKENS,
  type CommandFinish,
  commandFinishSchema,
  estimateTokens,
  FINISH_TOOL_NAME,
  FORCE_FINISH_MESSAGE,
  forceFinish,
  formatZodError,
  NO_TOOL_CALL_MESSAGE,
  RUN_PROMPT_TOKEN_CEILING,
  repairToolArguments,
  STRUCTURED_MAX_TOKENS_CAP,
  toolMessage,
  userMessage
} from '../ai'
import { KaError } from '../core/errors'
import type { AIProvider, ChatMessage, ChatRequest, Logger, ToolCall, ToolSpec } from '../ports'
import type { StepDraft, ToolResult } from './tools/handlers'

export const COMMAND_MAX_STEPS = 8

export interface ToolLoopOptions {
  provider: AIProvider
  /** Initial transcript (system + user). */
  messages: ChatMessage[]
  tools: readonly ToolSpec[]
  finish: ToolSpec
  dispatch(name: string, rawArgs: string): Promise<ToolResult>
  /** Called after every numbered step (ok or rejected, including finish). */
  onStep(step: AgentStep): void
  signal?: AbortSignal
  maxSteps?: number
  tokenCeiling?: number
  logger: Logger
  task?: string
}

export interface ToolLoopResult {
  finish: CommandFinish
  usage: AgentUsage
  steps: AgentStep[]
}

/**
 * Lenient shape fixes seen live on MiniMax-M3 before zod: `cues.timeframe` as a string ("the last
 * few weeks") -> `{ label }`, `cues.types`/`topics` as a single string -> list, `sources` as bare ids ->
 * `{ itemId }`, `cues` given as a list of words -> topics.
 */
export function normalizeFinishArguments(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
  const out: Record<string, unknown> = { ...(value as Record<string, unknown>) }
  const list = (v: unknown): unknown => (typeof v === 'string' ? [v] : v)
  if (Array.isArray(out.cues)) out.cues = { topics: out.cues }
  if (typeof out.cues === 'object' && out.cues !== null) {
    const cues = { ...(out.cues as Record<string, unknown>) }
    if (typeof cues.timeframe === 'string')
      cues.timeframe = cues.timeframe.trim() ? { label: cues.timeframe.trim() } : undefined
    if (cues.timeframe && typeof cues.timeframe === 'object') {
      const tf = { ...(cues.timeframe as Record<string, unknown>) }
      for (const key of ['since', 'until', 'label'] as const)
        if (tf[key] !== undefined && typeof tf[key] !== 'string') tf[key] = String(tf[key])
      cues.timeframe = tf
    }
    cues.topics = list(cues.topics)
    cues.types = list(cues.types)
    out.cues = cues
  }
  if (Array.isArray(out.sources)) {
    out.sources = out.sources.map((s) => (typeof s === 'string' ? { itemId: s, why: 'Cited.' } : s))
  }
  return out
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new KaError('CANCELLED', 'Stopped.')
}

/** Run the loop until `finish` validates. Throws `KaError` (`CANCELLED`, provider codes, `AI_UNAVAILABLE`). */
export async function runToolLoop(opts: ToolLoopOptions): Promise<ToolLoopResult> {
  const maxSteps = opts.maxSteps ?? COMMAND_MAX_STEPS
  const ceiling = opts.tokenCeiling ?? RUN_PROMPT_TOKEN_CEILING
  const messages: ChatMessage[] = [...opts.messages]
  const steps: AgentStep[] = []
  const usage: AgentUsage = { promptTokens: 0, completionTokens: 0, calls: 0, latencyMs: 0 }
  let maxTokens = AGENT_MAX_TOKENS
  let nudged = false
  let lengthRetried = false
  let finishRetried = false
  let forceNext = false

  const record = (draft: StepDraft, durationMs: number): AgentStep => {
    const step: AgentStep = { ...draft, n: steps.length + 1, durationMs }
    steps.push(step)
    opts.onStep(step)
    return step
  }

  for (let step = 1; step <= maxSteps + 1; step++) {
    throwIfAborted(opts.signal)
    const last = step >= maxSteps || usage.promptTokens >= ceiling || estimateTokens(messages) >= ceiling
    if (last && !forceNext) {
      messages.push(userMessage(FORCE_FINISH_MESSAGE))
      forceNext = true
    }
    const req: ChatRequest = {
      messages,
      maxTokens,
      task: opts.task ?? 'command',
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(forceNext
        ? forceFinish(opts.finish)
        : { tools: [...opts.tools, opts.finish], toolChoice: nudged ? 'required' : 'auto' })
    }
    const started = Date.now()
    const response = await opts.provider.chat(req)
    usage.calls += 1
    usage.promptTokens += response.usage.promptTokens
    usage.completionTokens += response.usage.completionTokens
    usage.latencyMs += response.usage.latencyMs

    if (response.finishReason === 'length') {
      if (!lengthRetried) {
        lengthRetried = true
        maxTokens = Math.min(maxTokens * 2, STRUCTURED_MAX_TOKENS_CAP)
        opts.logger.warn('agent.loop.truncated; retrying with more room', { maxTokens })
        step--
        continue
      }
      throw new KaError('AI_UNAVAILABLE', 'The answer was cut off twice. Try a narrower question.')
    }

    const calls: ToolCall[] = response.message.tool_calls ?? []
    if (calls.length === 0) {
      if (!nudged) {
        nudged = true
        // Echo the full assistant message back so opaque reasoning survives the nudge.
        messages.push(response.message, userMessage(NO_TOOL_CALL_MESSAGE))
        step--
        continue
      }
      throw new KaError('AI_UNAVAILABLE', 'The model answered without delivering a result.')
    }
    // Echo the full assistant message back so opaque reasoning survives the tool round trip.
    messages.push(response.message)
    const finishCall = calls.find((c) => c.function.name === FINISH_TOOL_NAME)
    const others = calls.filter((c) => c !== finishCall)

    // Independent reads run concurrently; results are appended in call order.
    const results = await Promise.all(
      others.map(async (call) => {
        const t0 = Date.now()
        const result = await opts.dispatch(call.function.name, call.function.arguments)
        return { call, result, durationMs: Date.now() - t0 }
      })
    )
    for (const { call, result, durationMs } of results) {
      messages.push(toolMessage(call.id, result.content))
      record(result.step, durationMs)
    }

    if (finishCall) {
      const repaired = repairToolArguments(finishCall.function.arguments)
      let problem = 'error' in repaired ? repaired.error : ''
      if (!problem) {
        try {
          const finish = commandFinishSchema.parse(normalizeFinishArguments((repaired as { value: unknown }).value))
          record(
            {
              tool: FINISH_TOOL_NAME,
              kind: 'finish',
              label: finish.kind === 'note' ? 'Writing a note' : 'Writing the answer',
              itemIds: finish.sources.map((s) => s.itemId),
              status: 'ok'
            },
            Date.now() - started
          )
          return { finish, usage, steps }
        } catch (error) {
          problem = formatZodError(error)
        }
      }
      record(
        {
          tool: FINISH_TOOL_NAME,
          kind: 'finish',
          label: 'Writing the answer',
          status: 'rejected',
          rejectReason: problem
        },
        Date.now() - started
      )
      messages.push(
        toolMessage(
          finishCall.id,
          JSON.stringify({ error: `finish was invalid: ${problem}. Call finish again with corrected arguments.` })
        )
      )
      if (finishRetried)
        throw new KaError('AI_UNAVAILABLE', "Couldn't make sense of the model's answer. Try again in a moment.")
      finishRetried = true
      forceNext = true
    }
  }
  throw new KaError('AI_UNAVAILABLE', 'Ran out of steps before an answer was ready.')
}
