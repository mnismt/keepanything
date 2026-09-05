import { DEFAULT_BASE_URL, DEFAULT_MODEL, LIMITS } from '../../shared/constants'
import { KaError } from '../core/errors'
import type {
  AIProvider,
  AssistantMessage,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  Clock,
  FinishReason,
  Logger,
  ToolCall,
  ToolChoice,
  ToolSpec,
  Usage
} from '../ports'
import { estimateTokens, hasImages, messagesForLog, stripImageParts, stripThink } from './messages'
import { STRUCTURED_MAX_TOKENS, withStructured } from './structured'

/** Injected sleep so retry tests never wait. Rejects when `signal` aborts. */
export type SleepFn = (ms: number, signal?: AbortSignal) => Promise<void>

export interface GmiProviderOptions {
  apiKey: string
  baseUrl?: string
  model?: string
  logger: Logger
  clock?: Clock
  fetchImpl?: typeof fetch
  sleep?: SleepFn
  /** `Math.random` replacement for jitter (tests). */
  random?: () => number
  /** Per-call timeout; default `LIMITS.aiTimeoutMs` (60 s). */
  timeoutMs?: number
  /** Retries after the first attempt for 429/5xx/network failures; default 3. */
  maxRetries?: number
  /** Sampling temperature per task; merged over `DEFAULT_TASK_TEMPERATURES`. */
  temperatures?: Record<string, number>
  /** Temperature for tasks not listed; default 0.2. */
  defaultTemperature?: number
}

/** Structured work at 0.2, prose (`command`) at 0.6. */
export const DEFAULT_TASK_TEMPERATURES: Readonly<Record<string, number>> = { command: 0.6 }
/** Default temperature for structured tasks. */
export const DEFAULT_TEMPERATURE = 0.2
/** Backoff before retry n (jittered ±25 %). */
export const RETRY_DELAYS_MS: readonly number[] = [2_000, 6_000, 15_000]
/** `retry-after` is honoured only up to this (GMI says 60 s, the outage is transient). */
export const RETRY_AFTER_CAP_MS = 15_000

const defaultSleep: SleepFn = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort(): void {
      clearTimeout(timer)
      reject(signal?.reason instanceof Error ? signal.reason : new Error('aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })

const systemClock: Clock = { now: () => new Date(), nowIso: () => new Date().toISOString() }

/** Wire body of one request (OpenAI chat completions). */
export interface GmiRequestBody {
  model: string
  messages: ChatMessage[]
  max_tokens: number
  temperature: number
  top_p?: number
  tools?: ToolSpec[]
  tool_choice?: 'auto' | 'required'
}

/**
 * Emulate tool choices the server ignores: a named choice becomes "only that tool +
 * required", `'none'` sends no tools at all. `'auto'`/`'required'` pass through.
 */
export function resolveTools(
  tools: ToolSpec[] | undefined,
  toolChoice: ToolChoice | undefined
): Pick<GmiRequestBody, 'tools' | 'tool_choice'> {
  if (!tools || tools.length === 0 || toolChoice === 'none') return {}
  if (typeof toolChoice === 'object') {
    const named = tools.filter((tool) => tool.function.name === toolChoice.function.name)
    return { tools: named.length > 0 ? named : tools, tool_choice: 'required' }
  }
  return { tools, tool_choice: toolChoice ?? 'auto' }
}

export function mapFinishReason(value: unknown): FinishReason {
  switch (value) {
    case 'stop':
    case 'length':
    case 'tool_calls':
    case 'content_filter':
      return value
    default:
      return 'unknown'
  }
}

/** Parse a `retry-after` header (seconds or HTTP date) into milliseconds, or null. */
export function parseRetryAfter(header: string | null, now: Date): number | null {
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(header)
  if (Number.isNaN(date)) return null
  return Math.max(0, date - now.getTime())
}

interface WireToolCall {
  id?: unknown
  type?: unknown
  function?: { name?: unknown; arguments?: unknown }
}

interface WireResponse {
  id?: unknown
  model?: unknown
  choices?: {
    message?: { role?: unknown; content?: unknown; tool_calls?: unknown; reasoning_content?: unknown }
    finish_reason?: unknown
  }[]
  usage?: {
    prompt_tokens?: unknown
    completion_tokens?: unknown
    total_tokens?: unknown
    prompt_tokens_details?: { cached_tokens?: unknown }
  }
  error?: { message?: unknown; type?: unknown; code?: unknown }
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** Normalise the wire message into `AssistantMessage` (think blocks stripped, `''` + tools -> null). */
export function normalizeAssistantMessage(
  message: NonNullable<WireResponse['choices']>[number]['message']
): AssistantMessage {
  const toolCalls: ToolCall[] = []
  if (Array.isArray(message?.tool_calls)) {
    for (const [index, call] of (message.tool_calls as WireToolCall[]).entries()) {
      const name = call?.function?.name
      if (typeof name !== 'string') continue
      const args = call.function?.arguments
      toolCalls.push({
        id: typeof call.id === 'string' && call.id.length > 0 ? call.id : `call_${index}`,
        type: 'function',
        function: {
          name,
          arguments: typeof args === 'string' ? args : args === undefined ? '{}' : JSON.stringify(args)
        }
      })
    }
  }
  let content: string | null = typeof message?.content === 'string' ? stripThink(message.content) : null
  if (content === '' && toolCalls.length > 0) content = null
  const out: AssistantMessage = { role: 'assistant', content }
  if (toolCalls.length > 0) out.tool_calls = toolCalls
  if (typeof message?.reasoning_content === 'string' && message.reasoning_content.length > 0) {
    out.reasoning_content = message.reasoning_content
  }
  return out
}

class RetryableError extends Error {
  constructor(
    message: string,
    readonly kind: 'http' | 'network' | 'timeout',
    readonly status?: number,
    readonly retryAfterMs?: number | null
  ) {
    super(message)
    this.name = 'RetryableError'
  }
}

export function createGmiProvider(opts: GmiProviderOptions): AIProvider {
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  const model = opts.model ?? DEFAULT_MODEL
  const logger = opts.logger.child({ provider: 'gmi', model })
  const clock = opts.clock ?? systemClock
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch
  const sleep = opts.sleep ?? defaultSleep
  const random = opts.random ?? Math.random
  const timeoutMs = opts.timeoutMs ?? LIMITS.aiTimeoutMs
  const maxRetries = opts.maxRetries ?? RETRY_DELAYS_MS.length
  const temperatures = { ...DEFAULT_TASK_TEMPERATURES, ...(opts.temperatures ?? {}) }
  const defaultTemperature = opts.defaultTemperature ?? DEFAULT_TEMPERATURE
  const endpoint = `${baseUrl}/chat/completions`

  if (!opts.apiKey) throw new KaError('AI_NOT_CONFIGURED', 'GMI API key is missing.')
  const authorization = `Bearer ${opts.apiKey}`

  function buildBody(req: ChatRequest, messages: ChatMessage[]): GmiRequestBody {
    const temperature = req.temperature ?? (req.task ? temperatures[req.task] : undefined) ?? defaultTemperature
    const body: GmiRequestBody = {
      model,
      messages,
      max_tokens: req.maxTokens ?? STRUCTURED_MAX_TOKENS,
      temperature: Math.min(2, Math.max(0, temperature)),
      ...resolveTools(req.tools, req.toolChoice)
    }
    if (req.topP !== undefined) body.top_p = req.topP
    return body
  }

  async function attemptOnce(
    body: GmiRequestBody,
    req: ChatRequest
  ): Promise<{ json: WireResponse; requestId: string | null; latencyMs: number }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('timeout')), req.timeoutMs ?? timeoutMs)
    const signal = req.signal ? AbortSignal.any([req.signal, controller.signal]) : controller.signal
    const started = Date.now()
    let response: Response
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization },
        body: JSON.stringify(body),
        signal
      })
    } catch (error) {
      clearTimeout(timer)
      if (req.signal?.aborted) throw new KaError('CANCELLED', 'The request was cancelled.')
      if (controller.signal.aborted) throw new RetryableError('The model did not answer in time.', 'timeout')
      throw new RetryableError(error instanceof Error ? error.message : String(error), 'network')
    }
    clearTimeout(timer)
    const latencyMs = Date.now() - started
    const requestId = response.headers.get('x-gmi-request-id')
    const text = await response.text()
    let json: WireResponse = {}
    try {
      json = text.length > 0 ? (JSON.parse(text) as WireResponse) : {}
    } catch {
      json = {}
    }

    if (!response.ok) {
      const message = typeof json.error?.message === 'string' ? json.error.message : `HTTP ${response.status}`
      const status = response.status
      if (status === 429 || status >= 500) {
        throw new RetryableError(
          message,
          'http',
          status,
          parseRetryAfter(response.headers.get('retry-after'), clock.now())
        )
      }
      if (status === 401 || status === 403) {
        throw new KaError('AI_NOT_CONFIGURED', 'GMI rejected the API key. Check it in Settings.', {
          status,
          requestId,
          message
        })
      }
      throw new ImageAwareHttpError(status, message, requestId)
    }
    return { json, requestId, latencyMs }
  }

  async function chat(req: ChatRequest): Promise<ChatResponse> {
    const task = req.task ?? 'chat'
    let messages = req.messages
    let imagesDropped = false
    let retriesLeft = maxRetries
    let attempts = 0

    logger.debug('ai.chat.request', {
      task,
      messages: messagesForLog(messages),
      tools: req.tools?.map((tool) => tool.function.name),
      toolChoice: req.toolChoice,
      estimatedPromptTokens: estimateTokens(messages)
    })

    for (;;) {
      attempts++
      const body = buildBody(req, messages)
      try {
        const { json, requestId, latencyMs } = await attemptOnce(body, req)
        const choice = json.choices?.[0]
        if (!choice?.message) {
          throw new RetryableError('Malformed response: no choices[0].message.', 'http', 200)
        }
        const message = normalizeAssistantMessage(choice.message)
        const usage: Usage = {
          promptTokens: asNumber(json.usage?.prompt_tokens),
          completionTokens: asNumber(json.usage?.completion_tokens),
          totalTokens: asNumber(
            json.usage?.total_tokens,
            asNumber(json.usage?.prompt_tokens) + asNumber(json.usage?.completion_tokens)
          ),
          latencyMs
        }
        const cachedTokens = asNumber(json.usage?.prompt_tokens_details?.cached_tokens)
        const finishReason = mapFinishReason(choice.finish_reason)
        logger.info('ai.chat', {
          task,
          model,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          cachedTokens,
          latencyMs,
          requestId,
          finishReason,
          attempts,
          imagesDropped,
          toolCalls: message.tool_calls?.map((call) => call.function.name)
        })
        return {
          id: typeof json.id === 'string' ? json.id : undefined,
          model: typeof json.model === 'string' ? json.model : model,
          message,
          finishReason,
          usage,
          raw: { response: json, requestId, attempts, imagesDropped, cachedTokens }
        }
      } catch (error) {
        if (error instanceof ImageAwareHttpError) {
          if (!imagesDropped && hasImages(messages)) {
            imagesDropped = true
            messages = stripImageParts(messages)
            logger.warn('ai.chat.images_dropped', { task, status: error.status, requestId: error.requestId })
            continue
          }
          throw new KaError('AI_UNAVAILABLE', 'The model rejected this request.', {
            status: error.status,
            message: error.message,
            requestId: error.requestId
          })
        }
        if (!(error instanceof RetryableError)) throw error
        if (retriesLeft <= 0) {
          const code = error.kind === 'network' ? 'OFFLINE' : 'AI_UNAVAILABLE'
          const text =
            error.kind === 'network'
              ? "Couldn't reach GMI. Check the connection."
              : error.kind === 'timeout'
                ? 'The model did not answer in time.'
                : 'GMI is busy right now. Try again in a moment.'
          logger.warn('ai.chat.failed', {
            task,
            kind: error.kind,
            status: error.status,
            attempts,
            message: error.message
          })
          throw new KaError(code, text, { kind: error.kind, status: error.status, attempts, message: error.message })
        }
        const retryIndex = maxRetries - retriesLeft
        retriesLeft--
        const base = RETRY_DELAYS_MS[Math.min(retryIndex, RETRY_DELAYS_MS.length - 1)] ?? 15_000
        const jittered = Math.round(base * (0.75 + random() * 0.5))
        const delay =
          error.retryAfterMs !== null && error.retryAfterMs !== undefined
            ? Math.min(error.retryAfterMs, RETRY_AFTER_CAP_MS)
            : jittered
        logger.warn('ai.chat.retry', {
          task,
          kind: error.kind,
          status: error.status,
          attempt: attempts,
          delayMs: delay,
          message: error.message
        })
        await sleep(delay, req.signal)
        if (req.signal?.aborted) throw new KaError('CANCELLED', 'The request was cancelled.')
      }
    }
  }

  return withStructured({ id: 'gmi', model, chat })
}

/** Non-retryable 4xx other than auth; `chat` turns it into an image-less retry when images were sent. */
class ImageAwareHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly requestId: string | null
  ) {
    super(message)
    this.name = 'HttpError'
  }
}
