import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { messageText, stripThink } from '../../src/main/ai/messages'
import { defineSchema } from '../../src/main/ai/schemas/common'
import { createScriptedProvider, jsonResponse, textResponse } from '../../src/main/ai/scripted-provider'
import {
  buildStructuredContract,
  extractJson,
  extractJsonCandidates,
  generateStructured,
  repairToolArguments
} from '../../src/main/ai/structured'
import { isKaError } from '../../src/main/core/errors'

const sampleSchema = defineSchema(
  'Sample',
  z.object({ title: z.string().min(1), score: z.coerce.number().min(0).max(1), tags: z.array(z.string()).default([]) })
)

describe('extractJsonCandidates', () => {
  it('parses raw JSON', () => {
    expect(extractJson('{"title":"a","score":0.5}')).toEqual({ title: 'a', score: 0.5 })
  })

  it('parses the last ```json fence and prefers json-labelled fences', () => {
    const text = 'Here you go:\n```\n{"title":"first"}\n```\nand\n```json\n{"title":"second","score":1}\n```\nDone.'
    expect(extractJson(text)).toEqual({ title: 'second', score: 1 })
  })

  it('finds a balanced object inside prose', () => {
    const text = 'Sure! The result is {"title":"x","score":0.2, "nested":{"a":[1,2,{"b":"}"}]}} hope that helps.'
    expect(extractJson(text)).toEqual({ title: 'x', score: 0.2, nested: { a: [1, 2, { b: '}' }] } })
  })

  it('strips <think> blocks before extracting', () => {
    const text = '<think>let me reason {not json}</think>\n{"title":"t","score":0}'
    expect(extractJson(text)).toEqual({ title: 't', score: 0 })
    expect(stripThink('<think>a</think>b')).toBe('b')
  })

  it('reports an error for empty or non-JSON text', () => {
    expect(extractJsonCandidates('').error).toMatch(/empty/i)
    expect(extractJsonCandidates('no json here').error).toMatch(/No JSON object/)
    expect(extractJsonCandidates('{"broken": ').candidates).toEqual([])
  })
})

describe('repairToolArguments', () => {
  it('accepts valid JSON and empty input', () => {
    expect(repairToolArguments('{"a":1}')).toEqual({ value: { a: 1 } })
    expect(repairToolArguments('')).toEqual({ value: {} })
  })

  it('fixes trailing commas, single quotes and unquoted keys', () => {
    expect(repairToolArguments("{'query': 'mac apps', k: 5, filters: {types: ['url'],},}")).toEqual({
      value: { query: 'mac apps', k: 5, filters: { types: ['url'] } }
    })
  })

  it('closes unbalanced braces and strings', () => {
    expect(repairToolArguments('{"query": "window tiling", "filters": {"types": ["url"')).toEqual({
      value: { query: 'window tiling', filters: { types: ['url'] } }
    })
    expect(repairToolArguments('{"query": "half a str')).toEqual({ value: { query: 'half a str' } })
  })

  it('strips fences and think blocks', () => {
    expect(repairToolArguments('<think>x</think>```json\n{"a": "b"}\n```')).toEqual({ value: { a: 'b' } })
  })

  it('returns an error when nothing can be salvaged', () => {
    expect(repairToolArguments('::: not even close :::')).toHaveProperty('error')
  })
})

describe('generateStructured', () => {
  const req = { messages: [{ role: 'user' as const, content: 'Describe it.' }], task: 'understand' }

  it('appends the contract to the last user message', () => {
    const contract = buildStructuredContract(sampleSchema)
    expect(contract).toContain('exactly these keys: title, score, tags')
    expect(contract).toContain('no markdown fences')
    expect(contract).toContain('JSON schema "Sample"')
  })

  it('returns the parsed value on the first attempt and sums usage', async () => {
    const provider = createScriptedProvider([
      { ...jsonResponse({ title: 'ok', score: '0.7' }), usage: { promptTokens: 10, completionTokens: 5, latencyMs: 3 } }
    ])
    const result = await generateStructured(provider, sampleSchema, req)
    expect(result.value).toEqual({ title: 'ok', score: 0.7, tags: [] })
    expect(result.usage.promptTokens).toBe(10)
    expect(messageText(provider.calls[0]?.messages[0] ?? { role: 'user', content: '' })).toContain('Describe it.')
    expect(messageText(provider.calls[0]?.messages[0] ?? { role: 'user', content: '' })).toContain('JSON schema')
  })

  it('accepts fenced JSON with prose around it', async () => {
    const provider = createScriptedProvider([textResponse('Sure:\n```json\n{"title":"fenced","score":1}\n```')])
    const result = await generateStructured(provider, sampleSchema, req)
    expect(result.value.title).toBe('fenced')
  })

  it('retries truncated output once with doubled max_tokens and a concise note', async () => {
    const provider = createScriptedProvider([
      textResponse('{"title":"trunc', 'length'),
      jsonResponse({ title: 'second', score: 0 })
    ])
    const result = await generateStructured(provider, sampleSchema, { ...req, maxTokens: 1000 })
    expect(result.value.title).toBe('second')
    expect(provider.calls[0]?.maxTokens).toBe(1000)
    expect(provider.calls[1]?.maxTokens).toBe(2000)
    expect(messageText(provider.calls[1]?.messages.at(-1) ?? { role: 'user', content: '' })).toContain('Be concise')
  })

  it('caps the doubled max_tokens', async () => {
    const provider = createScriptedProvider([textResponse('x', 'length'), jsonResponse({ title: 'y', score: 0 })])
    await generateStructured(provider, sampleSchema, { ...req, maxTokens: 12_000 })
    expect(provider.calls[1]?.maxTokens).toBe(16_384)
  })

  it('feeds the validation error back and succeeds on retry', async () => {
    const provider = createScriptedProvider([
      jsonResponse({ title: '', score: 5 }),
      jsonResponse({ title: 'fixed', score: 0.5 })
    ])
    const result = await generateStructured(provider, sampleSchema, req)
    expect(result.value.title).toBe('fixed')
    const retryMessages = provider.calls[1]?.messages ?? []
    expect(retryMessages.at(-2)?.role).toBe('assistant')
    expect(messageText(retryMessages.at(-1) ?? { role: 'user', content: '' })).toMatch(/The JSON was invalid: .*title/s)
  })

  it('treats empty content as retryable', async () => {
    const provider = createScriptedProvider([textResponse(''), jsonResponse({ title: 'later', score: 0.1 })])
    const result = await generateStructured(provider, sampleSchema, req)
    expect(result.value.title).toBe('later')
  })

  it('picks the first candidate that passes the schema', async () => {
    const provider = createScriptedProvider([
      textResponse('{"title":"bad","score":9} was wrong, use ```json\n{"title":"good","score":0.9}\n```')
    ])
    const result = await generateStructured(provider, sampleSchema, req)
    expect(result.value.title).toBe('good')
  })

  it('throws AI_UNAVAILABLE in product voice after two failures', async () => {
    const provider = createScriptedProvider([textResponse('nope'), textResponse('still nope')])
    await expect(generateStructured(provider, sampleSchema, req)).rejects.toSatisfy((error: unknown) => {
      expect(isKaError(error)).toBe(true)
      if (!isKaError(error)) return false
      expect(error.code).toBe('AI_UNAVAILABLE')
      expect(error.message).toMatch(/Couldn't make sense/)
      return true
    })
    expect(provider.calls).toHaveLength(2)
  })

  it('propagates provider errors untouched', async () => {
    const provider = createScriptedProvider([() => new Error('boom')])
    await expect(generateStructured(provider, sampleSchema, req)).rejects.toThrow('boom')
  })
})
