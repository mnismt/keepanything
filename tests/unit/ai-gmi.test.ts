import { describe, expect, it } from 'vitest'
import { imagePart, textPart } from '../../src/main/ai/messages'
import {
  createOpenAiCompatibleProvider,
  mapFinishReason,
  type OpenAiCompatibleProviderOptions,
  parseRetryAfter,
  resolveTools
} from '../../src/main/ai/openai-compatible'
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

function gmiHarness(replies: Reply[], overrides: Partial<OpenAiCompatibleProviderOptions> = {}) {
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
  const provider = createOpenAiCompatibleProvider({
    provider: 'gmi',
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

function openRouterHarness(replies: Reply[], overrides: Partial<OpenAiCompatibleProviderOptions> = {}) {
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
      headers: next.headers ?? {}
    })
  }
  const logger = fakeLogger()
  const provider = createOpenAiCompatibleProvider({
    provider: 'openrouter',
    apiKey: 'test-key-not-a-secret',
    model: 'test/openrouter-model',
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

  it('GMI: emulates named tool choice as "only that tool + required"', () => {
    expect(resolveTools('gmi', tools, { type: 'function', function: { name: 'finish' } })).toEqual({
      tools: [tools[1]],
      tool_choice: 'required'
    })
  })

  it('GMI: emulates none by sending no tools', () => {
    expect(resolveTools('gmi', tools, 'none')).toEqual({})
  })

  it('GMI: passes auto/required through and defaults to auto', () => {
    expect(resolveTools('gmi', tools, 'required').tool_choice).toBe('required')
    expect(resolveTools('gmi', tools, undefined).tool_choice).toBe('auto')
    expect(resolveTools('gmi', undefined, 'required')).toEqual({})
  })

  it('OpenRouter: forwards the native tool_choice shape', () => {
    expect(resolveTools('openrouter', tools, { type: 'function', function: { name: 'finish' } })).toEqual({
      tools,
      tool_choice: { type: 'function', function: { name: 'finish' } }
    })
    expect(resolveTools('openrouter', tools, 'auto').tool_choice).toBe('auto')
    expect(resolveTools('openrouter', tools, 'required').tool_choice).toBe('required')
    expect(resolveTools('openrouter', tools, undefined).tool_choice).toBe('auto')
  })

  it('OpenRouter: omits tools when none', () => {
    expect(resolveTools('openrouter', tools, 'none')).toEqual({})
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

describe('createOpenAiCompatibleProvider (GMI)', () => {
  it('builds an OpenAI-shaped request without response_format and with task temperature', async () => {
    const { provider, requests } = gmiHarness([{ status: 200, body: okBody('hello') }])
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
    const { provider, requests } = gmiHarness([
      { status: 200, body: okBody('a') },
      { status: 200, body: okBody('b') }
    ])
    await provider.chat({ messages: user('q'), task: 'command' })
    await provider.chat({ messages: user('q'), task: 'command', temperature: 1 })
    expect(requests[0]?.body.temperature).toBe(0.6)
    expect(requests[1]?.body.temperature).toBe(1)
  })

  it('logs request id, latency and cached tokens at info without the key or prompt', async () => {
    const { provider, logger } = gmiHarness([{ status: 200, body: okBody('hello') }])
    await provider.chat({ messages: user('secret prompt text'), task: 'understand' })
    const info = logger.lines.find((l) => l.level === 'info' && l.msg === 'ai.chat')
    expect(info?.fields).toMatchObject({ task: 'understand', requestId: 'req-1', cachedTokens: 64, promptTokens: 100 })
    expect(JSON.stringify(info)).not.toContain('test-key-not-a-secret')
    expect(JSON.stringify(info)).not.toContain('secret prompt text')
  })

  it('strips <think> blocks and nulls empty content when tool calls are present', async () => {
    const { provider } = gmiHarness([
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
    const { provider, sleeps, requests } = gmiHarness([
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
    const { provider, sleeps } = gmiHarness(
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
    const { provider, requests } = gmiHarness([
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
    const { provider } = gmiHarness([
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
    const { provider, requests } = gmiHarness([{ status: 401, body: { error: { message: 'bad key' } } }])
    await expect(provider.chat({ messages: user('x') })).rejects.toSatisfy(
      (e: unknown) => isKaError(e) && e.code === 'AI_NOT_CONFIGURED'
    )
    expect(requests).toHaveLength(1)
  })

  it('drops images and retries once on a 400 backend_error', async () => {
    const { provider, requests, logger } = gmiHarness([
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
    const { provider, requests } = gmiHarness([{ status: 400, body: { error: { message: 'bad request' } } }])
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
    const { provider, requests } = gmiHarness([
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
    const provider = createOpenAiCompatibleProvider({
      provider: 'gmi',
      apiKey: 'k',
      logger: fakeLogger(),
      fetchImpl,
      sleep: async () => {}
    })
    await expect(provider.chat({ messages: user('x'), signal: controller.signal })).rejects.toSatisfy(
      (e: unknown) => isKaError(e) && e.code === 'CANCELLED'
    )
  })

  it('treats a malformed 200 as retryable', async () => {
    const { provider, requests } = gmiHarness([
      { status: 200, body: { choices: [] } },
      { status: 200, body: okBody('ok') }
    ])
    const res = await provider.chat({ messages: user('x') })
    expect(res.message.content).toBe('ok')
    expect(requests).toHaveLength(2)
  })

  it('exposes generateStructured through the same provider', async () => {
    const { provider } = gmiHarness([{ status: 200, body: okBody('{"n": 2}') }])
    const schema = {
      name: 'N',
      parse: (v: unknown) => v as { n: number },
      jsonSchema: { type: 'object', properties: { n: {} } }
    }
    const result = await provider.generateStructured(schema, { messages: user('count'), task: 'understand' })
    expect(result.value).toEqual({ n: 2 })
  })
})

describe('createOpenAiCompatibleProvider (OpenRouter)', () => {
  it('throws AI_NOT_CONFIGURED when model is empty, without making a request', () => {
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls++
      return new Response('{}', { status: 200 })
    }
    expect(() =>
      createOpenAiCompatibleProvider({
        provider: 'openrouter',
        apiKey: 'sk-openrouter',
        model: '   ',
        logger: fakeLogger(),
        fetchImpl
      })
    ).toThrowError(/Enter a model ID/)
    expect(calls).toBe(0)
  })

  it('sends the OpenRouter base URL, bearer key and explicit model', async () => {
    const { provider, requests } = openRouterHarness([{ status: 200, body: okBody('hello') }])
    const res = await provider.chat({ messages: user('hi') })
    expect(res.message.content).toBe('hello')
    const first = requests[0]
    expect(first?.url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(first?.headers.authorization).toBe('Bearer test-key-not-a-secret')
    expect(first?.body).toMatchObject({ model: 'test/openrouter-model', max_tokens: 8192, temperature: 0.2 })
    expect(res.raw && (res.raw as { requestId: unknown }).requestId === null).toBe(true)
  })

  it('maps 401 to AI_NOT_CONFIGURED with OpenRouter copy', async () => {
    const { provider } = openRouterHarness([{ status: 401, body: { error: { message: 'bad key' } } }])
    await expect(provider.chat({ messages: user('x') })).rejects.toSatisfy(
      (e: unknown) => isKaError(e) && e.code === 'AI_NOT_CONFIGURED' && /OpenRouter/.test(e.message)
    )
  })

  it('maps 402 to AI_UNAVAILABLE with the credit copy, retrying once on a 5xx then giving up', async () => {
    const { provider, requests } = openRouterHarness([
      { status: 402, body: { error: { message: 'insufficient credits' } } }
    ])
    await expect(provider.chat({ messages: user('x') })).rejects.toSatisfy(
      (e: unknown) => isKaError(e) && e.code === 'AI_UNAVAILABLE' && /insufficient credits/.test(e.message)
    )
    expect(requests).toHaveLength(1)
  })

  it('does not retry 402 with an image, causing only one attempt', async () => {
    const { provider, requests } = openRouterHarness([
      { status: 402, body: { error: { message: 'insufficient credits' } } }
    ])
    await expect(
      provider.chat({
        messages: [{ role: 'user', content: [textPart('what'), imagePart('data:image/png;base64,AAAA')] }],
        task: 'understand'
      })
    ).rejects.toSatisfy(
      (e: unknown) => isKaError(e) && e.code === 'AI_UNAVAILABLE' && /insufficient credits/.test(e.message)
    )
    expect(requests).toHaveLength(1)
  })

  it('maps 403 to AI_UNAVAILABLE with the OpenRouter permissions copy', async () => {
    const { provider } = openRouterHarness([{ status: 403, body: { error: { message: 'no' } } }])
    await expect(provider.chat({ messages: user('x') })).rejects.toSatisfy(
      (e: unknown) => isKaError(e) && e.code === 'AI_UNAVAILABLE' && /OpenRouter/.test(e.message)
    )
  })

  it('fails fast on a non-transient error embedded in an HTTP 200', async () => {
    const { provider, requests } = openRouterHarness([
      { status: 200, body: { error: { message: 'bad model id', code: 400 } } }
    ])
    await expect(provider.chat({ messages: user('x') })).rejects.toSatisfy(
      (e: unknown) => isKaError(e) && e.code === 'AI_UNAVAILABLE' && /bad model id/.test(e.message)
    )
    expect(requests).toHaveLength(1)
  })

  it('retries a transient choice-level error on HTTP 200 instead of yielding partial output', async () => {
    const { provider, requests } = openRouterHarness([
      {
        status: 200,
        body: {
          id: 'or-1',
          choices: [
            {
              finish_reason: 'error',
              error: { code: 503, message: 'upstream timeout' },
              message: { role: 'assistant', content: 'half-baked answer' }
            }
          ]
        }
      },
      {
        status: 200,
        body: { id: 'or-2', choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] }
      }
    ])
    const response = await provider.chat({ messages: user('x') })
    expect(response.message.content).toBe('ok')
    expect(requests).toHaveLength(2)
  })

  it('retries 429 and eventually succeeds with jittered backoff', async () => {
    const { provider, requests, sleeps } = openRouterHarness([
      { status: 429, body: { error: { message: 'rate' } } },
      { status: 429, body: { error: { message: 'rate' } } },
      { status: 200, body: okBody('finally') }
    ])
    const res = await provider.chat({ messages: user('x') })
    expect(res.message.content).toBe('finally')
    expect(requests).toHaveLength(3)
    expect(sleeps).toEqual([2_000, 6_000])
  })

  it('preserves the native named tool_choice for OpenRouter', async () => {
    const tools: ToolSpec[] = [
      { type: 'function', function: { name: 'search', parameters: { type: 'object' } } },
      { type: 'function', function: { name: 'finish', parameters: { type: 'object' } } }
    ]
    const { provider, requests } = openRouterHarness([
      { status: 200, body: okBody('a') },
      { status: 200, body: okBody('b') }
    ])
    await provider.chat({
      messages: user('x'),
      tools,
      toolChoice: { type: 'function', function: { name: 'finish' } }
    })
    await provider.chat({ messages: user('x'), tools, toolChoice: 'none' })
    const first = requests[0]?.body as { tools: ToolSpec[]; tool_choice: unknown }
    expect(first.tools).toHaveLength(2)
    expect(first.tool_choice).toEqual({ type: 'function', function: { name: 'finish' } })
    expect(requests[1]?.body).not.toHaveProperty('tools')
  })

  it('throws AI_NOT_CONFIGURED when the API key is missing, without making a request', async () => {
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls++
      return new Response('{}', { status: 200 })
    }
    expect(() =>
      createOpenAiCompatibleProvider({
        provider: 'openrouter',
        apiKey: '',
        model: 'test/openrouter-model',
        logger: fakeLogger(),
        fetchImpl
      })
    ).toThrow(/OpenRouter API key is missing/)
    expect(calls).toBe(0)
  })
})
