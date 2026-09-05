import { describe, expect, it } from 'vitest'
import {
  createGmiProvider,
  type GmiProviderOptions,
  mapFinishReason,
  parseRetryAfter,
  resolveTools
} from '../../src/main/ai/gmi-minimax'
import { imagePart, textPart } from '../../src/main/ai/messages'
import { isKaError } from '../../src/main/core/errors'
import type { LogFields, Logger, ToolSpec } from '../../src/main/ports'

interface LogLine {
  level: string
  msg: string
  fields?: LogFields
}

function fakeLogger(lines: LogLine[] = []): Logger & { lines: LogLine[] } {
  const make = (base: LogFields): Logger & { lines: LogLine[] } => ({
    lines,
    debug: (msg, fields) => lines.push({ level: 'debug', msg, fields: { ...base, ...fields } }),
    info: (msg, fields) => lines.push({ level: 'info', msg, fields: { ...base, ...fields } }),
    warn: (msg, fields) => lines.push({ level: 'warn', msg, fields: { ...base, ...fields } }),
    error: (msg, fields) => lines.push({ level: 'error', msg, fields: { ...base, ...fields } }),
    child: (fields) => make({ ...base, ...fields })
  })
  return make({})
}

type Reply = { status: number; body?: unknown; headers?: Record<string, string> } | Error

function okBody(content: string | null, extra: Record<string, unknown> = {}) {
  return {
    id: 'chatcmpl-1',
    model: 'MiniMaxAI/MiniMax-M3',
    choices: [{ index: 0, message: { role: 'assistant', content, ...extra }, finish_reason: 'stop' }],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 20,
      total_tokens: 120,
      prompt_tokens_details: { cached_tokens: 64 }
    }
  }
}

function harness(replies: Reply[], overrides: Partial<GmiProviderOptions> = {}) {
  const requests: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = []
  const sleeps: number[] = []
  const queue = [...replies]
  const fetchImpl: typeof fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    requests.push({ url: String(input), body, headers: (init?.headers as Record<string, string>) ?? {} })
    const next = queue.shift()
    if (!next) throw new Error('no more replies')
    if (next instanceof Error) throw next
    return new Response(next.body === undefined ? '' : JSON.stringify(next.body), {
      status: next.status,
      headers: { 'x-gmi-request-id': `req-${requests.length}`, ...(next.headers ?? {}) }
    })
  }
  const logger = fakeLogger()
  const provider = createGmiProvider({
    apiKey: 'test-key-not-a-secret',
    logger,
    fetchImpl,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
    random: () => 0.5,
    ...overrides
  })
  return { provider, requests, sleeps, logger }
}

const user = (text: string) => [{ role: 'user' as const, content: text }]

describe('resolveTools / mapFinishReason / parseRetryAfter', () => {
  const tools: ToolSpec[] = [
    { type: 'function', function: { name: 'search', parameters: { type: 'object' } } },
    { type: 'function', function: { name: 'finish', parameters: { type: 'object' } } }
  ]

  it('emulates named tool choice as "only that tool + required"', () => {
    expect(resolveTools(tools, { type: 'function', function: { name: 'finish' } })).toEqual({
      tools: [tools[1]],
      tool_choice: 'required'
    })
  })

  it('emulates none by sending no tools', () => {
    expect(resolveTools(tools, 'none')).toEqual({})
  })

  it('passes auto/required through and defaults to auto', () => {
    expect(resolveTools(tools, 'required').tool_choice).toBe('required')
    expect(resolveTools(tools, undefined).tool_choice).toBe('auto')
    expect(resolveTools(undefined, 'required')).toEqual({})
  })

  it('maps finish reasons', () => {
    expect(mapFinishReason('stop')).toBe('stop')
    expect(mapFinishReason('length')).toBe('length')
    expect(mapFinishReason('tool_calls')).toBe('tool_calls')
    expect(mapFinishReason('weird')).toBe('unknown')
  })

  it('parses retry-after seconds and dates', () => {
    const now = new Date('2026-09-03T10:00:00Z')
    expect(parseRetryAfter('60', now)).toBe(60_000)
    expect(parseRetryAfter('Thu, 03 Sep 2026 10:00:05 GMT', now)).toBe(5_000)
    expect(parseRetryAfter(null, now)).toBeNull()
    expect(parseRetryAfter('garbage', now)).toBeNull()
  })
})

describe('createGmiProvider', () => {
  it('builds an OpenAI-shaped request without response_format and with task temperature', async () => {
    const { provider, requests } = harness([{ status: 200, body: okBody('hello') }])
    const res = await provider.chat({
      messages: user('hi'),
      task: 'understand',
      responseFormat: { type: 'json_object' }
    })
    expect(res.message.content).toBe('hello')
    expect(res.finishReason).toBe('stop')
    expect(res.usage).toMatchObject({ promptTokens: 100, completionTokens: 20, totalTokens: 120 })
    const request = requests[0]
    expect(request?.url).toBe('https://api.gmi-serving.com/v1/chat/completions')
    expect(request?.headers.authorization).toBe('Bearer test-key-not-a-secret')
    expect(request?.body).toMatchObject({ model: 'MiniMaxAI/MiniMax-M3', max_tokens: 8192, temperature: 0.2 })
    expect(request?.body).not.toHaveProperty('response_format')
    expect(request?.body).not.toHaveProperty('tools')
  })

  it('uses 0.6 for command and honours explicit temperature', async () => {
    const { provider, requests } = harness([
      { status: 200, body: okBody('a') },
      { status: 200, body: okBody('b') }
    ])
    await provider.chat({ messages: user('q'), task: 'command' })
    await provider.chat({ messages: user('q'), task: 'command', temperature: 1 })
    expect(requests[0]?.body.temperature).toBe(0.6)
    expect(requests[1]?.body.temperature).toBe(1)
  })

  it('logs request id, latency and cached tokens at info without the key or prompt', async () => {
    const { provider, logger } = harness([{ status: 200, body: okBody('hello') }])
    await provider.chat({ messages: user('secret prompt text'), task: 'understand' })
    const info = logger.lines.find((l) => l.level === 'info' && l.msg === 'ai.chat')
    expect(info?.fields).toMatchObject({ task: 'understand', requestId: 'req-1', cachedTokens: 64, promptTokens: 100 })
    expect(JSON.stringify(info)).not.toContain('test-key-not-a-secret')
    expect(JSON.stringify(info)).not.toContain('secret prompt text')
  })

  it('strips <think> blocks and nulls empty content when tool calls are present', async () => {
    const { provider } = harness([
      {
        status: 200,
        body: {
          ...okBody('', {
            tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'search', arguments: '{"q":1}' } }]
          }),
          choices: [
            {
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'search', arguments: { q: 1 } } }]
              },
              finish_reason: 'tool_calls'
            }
          ]
        }
      },
      { status: 200, body: okBody('<think>hmm</think>\n{"a":1}') }
    ])
    const first = await provider.chat({ messages: user('x') })
    expect(first.message.content).toBeNull()
    expect(first.finishReason).toBe('tool_calls')
    expect(first.message.tool_calls?.[0]?.function.arguments).toBe('{"q":1}')
    const second = await provider.chat({ messages: user('x') })
    expect(second.message.content).toBe('{"a":1}')
  })

  it('retries 429/5xx with jittered 2/6/15 s backoff and honours retry-after capped at 15 s', async () => {
    const { provider, sleeps, requests } = harness([
      { status: 429, body: { error: { message: 'overloaded' } }, headers: { 'retry-after': '60' } },
      { status: 503, body: { error: { message: 'down' } } },
      { status: 500, body: {} },
      { status: 200, body: okBody('finally') }
    ])
    const res = await provider.chat({ messages: user('x') })
    expect(res.message.content).toBe('finally')
    expect(requests).toHaveLength(4)
    expect(sleeps).toEqual([15_000, 6_000, 15_000])
    expect((res.raw as { attempts: number }).attempts).toBe(4)
  })

  it('applies jitter from the injected random', async () => {
    const { provider, sleeps } = harness(
      [
        { status: 500, body: {} },
        { status: 200, body: okBody('ok') }
      ],
      {
        random: () => 0
      }
    )
    await provider.chat({ messages: user('x') })
    expect(sleeps).toEqual([1_500])
  })

  it('gives up after 3 retries with AI_UNAVAILABLE', async () => {
    const { provider, requests } = harness([
      { status: 500, body: {} },
      { status: 500, body: {} },
      { status: 500, body: {} },
      { status: 500, body: {} }
    ])
    await expect(provider.chat({ messages: user('x') })).rejects.toSatisfy(
      (e: unknown) => isKaError(e) && e.code === 'AI_UNAVAILABLE' && /busy/.test(e.message)
    )
    expect(requests).toHaveLength(4)
  })

  it('retries network errors and reports OFFLINE when they persist', async () => {
    const { provider } = harness([
      new TypeError('fetch failed'),
      new TypeError('fetch failed'),
      new TypeError('fetch failed'),
      new TypeError('fetch failed')
    ])
    await expect(provider.chat({ messages: user('x') })).rejects.toSatisfy(
      (e: unknown) => isKaError(e) && e.code === 'OFFLINE'
    )
  })

  it('maps 401 to AI_NOT_CONFIGURED without retrying', async () => {
    const { provider, requests } = harness([{ status: 401, body: { error: { message: 'bad key' } } }])
    await expect(provider.chat({ messages: user('x') })).rejects.toSatisfy(
      (e: unknown) => isKaError(e) && e.code === 'AI_NOT_CONFIGURED'
    )
    expect(requests).toHaveLength(1)
  })

  it('drops images and retries once on a 400 backend_error', async () => {
    const { provider, requests, logger } = harness([
      { status: 400, body: { error: { message: 'backend_error: remote returned status 400 (2013)' } } },
      { status: 200, body: okBody('text only') }
    ])
    const res = await provider.chat({
      messages: [{ role: 'user', content: [textPart('what is this'), imagePart('data:image/png;base64,AAAA')] }],
      task: 'understand'
    })
    expect(res.message.content).toBe('text only')
    expect((res.raw as { imagesDropped: boolean }).imagesDropped).toBe(true)
    expect(requests).toHaveLength(2)
    const second = requests[1]?.body.messages as { content: unknown[] }[]
    expect(second[0]?.content).toEqual([{ type: 'text', text: 'what is this' }])
    expect(logger.lines.some((l) => l.msg === 'ai.chat.images_dropped')).toBe(true)
  })

  it('does not retry a 400 without images', async () => {
    const { provider, requests } = harness([{ status: 400, body: { error: { message: 'bad request' } } }])
    await expect(provider.chat({ messages: user('x') })).rejects.toSatisfy(
      (e: unknown) => isKaError(e) && e.code === 'AI_UNAVAILABLE'
    )
    expect(requests).toHaveLength(1)
  })

  it('sends only the named tool with required, and no tools for none', async () => {
    const tools: ToolSpec[] = [
      { type: 'function', function: { name: 'search', parameters: { type: 'object' } } },
      { type: 'function', function: { name: 'finish', parameters: { type: 'object' } } }
    ]
    const { provider, requests } = harness([
      { status: 200, body: okBody('a') },
      { status: 200, body: okBody('b') }
    ])
    await provider.chat({ messages: user('x'), tools, toolChoice: { type: 'function', function: { name: 'finish' } } })
    await provider.chat({ messages: user('x'), tools, toolChoice: 'none' })
    const first = requests[0]?.body as { tools: ToolSpec[]; tool_choice: string }
    expect(first.tools.map((t) => t.function.name)).toEqual(['finish'])
    expect(first.tool_choice).toBe('required')
    expect(requests[1]?.body).not.toHaveProperty('tools')
    expect(requests[1]?.body).not.toHaveProperty('tool_choice')
  })

  it('reports CANCELLED when the caller aborts', async () => {
    const controller = new AbortController()
    const fetchImpl: typeof fetch = async (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        controller.abort()
      })
    const provider = createGmiProvider({ apiKey: 'k', logger: fakeLogger(), fetchImpl, sleep: async () => {} })
    await expect(provider.chat({ messages: user('x'), signal: controller.signal })).rejects.toSatisfy(
      (e: unknown) => isKaError(e) && e.code === 'CANCELLED'
    )
  })

  it('treats a malformed 200 as retryable', async () => {
    const { provider, requests } = harness([
      { status: 200, body: { choices: [] } },
      { status: 200, body: okBody('ok') }
    ])
    const res = await provider.chat({ messages: user('x') })
    expect(res.message.content).toBe('ok')
    expect(requests).toHaveLength(2)
  })

  it('exposes generateStructured through the same provider', async () => {
    const { provider } = harness([{ status: 200, body: okBody('{"n": 2}') }])
    const schema = {
      name: 'N',
      parse: (v: unknown) => v as { n: number },
      jsonSchema: { type: 'object', properties: { n: {} } }
    }
    const result = await provider.generateStructured(schema, { messages: user('count'), task: 'understand' })
    expect(result.value).toEqual({ n: 2 })
  })
})
