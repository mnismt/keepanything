import { describe, expect, it } from 'vitest'
import { createMockProvider, guessKind, keywords } from '../../src/main/ai/mock-provider'
import {
  buildCommandMessages,
  buildConsolidateRequest,
  buildFolderRequest,
  buildOrganizeBatchRequest,
  buildOrganizeRequest,
  buildUnderstandRequest,
  finishToolSpec,
  forceFinish
} from '../../src/main/ai/prompts'
import { createAiProvider, createOffProvider } from '../../src/main/ai/provider'
import {
  commandFinishSchema,
  consolidatePlanSchema,
  folderUnderstandingSchema,
  organizePlanSchema,
  understandingSchema
} from '../../src/main/ai/schemas'
import { repairToolArguments } from '../../src/main/ai/structured'
import { isKaError } from '../../src/main/core/errors'
import type { Logger, ToolSpec } from '../../src/main/ports'

const logger: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => logger }

describe('mock provider heuristics', () => {
  it('guesses kinds from domain, type and text', () => {
    expect(guessKind('url', 'github_repo', 'github.com', 'A CLI for tiling windows from the terminal')).toBe('cli_tool')
    expect(guessKind('url', 'github_repo', 'github.com', 'React hooks library')).toBe('library')
    expect(guessKind('url', 'article', 'blog.example.com', 'Thoughts on batching')).toBe('article')
    expect(guessKind('image', 'screenshot', null, '')).toBe('screenshot')
    expect(guessKind('pdf', null, null, 'Order confirmation. Subtotal $12')).toBe('receipt')
    expect(guessKind('url', null, 'arxiv.org', 'Abstract ... Introduction')).toBe('paper')
  })

  it('extracts keywords without stopwords', () => {
    expect(keywords('The quick brown fox jumps over the lazy dog fox fox', 3)).toEqual(['fox', 'quick', 'brown'])
  })
})

describe('mock provider structured output', () => {
  const provider = createMockProvider({ logger })

  it('produces a schema-valid Understanding for a repo', async () => {
    const req = buildUnderstandRequest({
      title: 'rxhanson/Rectangle',
      type: 'url',
      subtype: 'github_repo',
      url: 'https://github.com/rxhanson/Rectangle',
      domain: 'github.com',
      text: 'Rectangle is a window management Mac app based on Spectacle, written in Swift. Move and resize windows in macOS using keyboard shortcuts or snap areas.'
    })
    const { value, usage } = await provider.generateStructured(understandingSchema, req)
    expect(value.kind).toBe('macos_app')
    expect(value.title).toBe('rxhanson/Rectangle')
    expect(value.topics.length).toBeGreaterThan(0)
    expect(value.retrievalHints.length).toBeGreaterThanOrEqual(3)
    expect(value.confidence).toBeGreaterThan(0.5)
    expect(usage.promptTokens).toBeGreaterThan(0)
    const again = await provider.generateStructured(understandingSchema, req)
    expect(again.value).toEqual(value)
  })

  it('marks images and handles missing text', async () => {
    const req = buildUnderstandRequest({
      title: 'Screenshot 2026-09-03',
      type: 'image',
      subtype: 'screenshot',
      images: ['data:image/png;base64,AAAA']
    })
    const { value } = await provider.generateStructured(understandingSchema, req)
    expect(value.kind).toBe('screenshot')
    expect(value.visualDescription).toBeTruthy()
  })

  it('produces a conservative OrganizePlan from candidates', async () => {
    const req = buildOrganizeRequest({
      item: { id: 'new', title: 'Loop', type: 'url', topics: ['window management'] },
      candidates: [
        {
          id: 'strong',
          title: 'Rectangle',
          type: 'url',
          cosine: 0.82,
          sharedTopics: ['window management'],
          sharedEntities: ['macOS']
        },
        { id: 'weak', title: 'Bread', type: 'url', cosine: 0.2 }
      ],
      collections: [{ id: 'c1', name: 'macOS utility references', count: 4, createdBy: 'agent', cosine: 0.8 }]
    })
    const { value } = await provider.generateStructured(organizePlanSchema, req)
    expect(value.relationships.map((r) => r.targetId)).toEqual(['strong'])
    expect(value.relationships[0]?.type).toBe('same_project')
    expect(value.addToCollections[0]).toMatchObject({ collectionId: 'c1', itemId: 'new' })
    expect(value.newCollections).toEqual([])
    expect(value.summary).toBe('Linked to 1 thing.')
  })

  it('links batch siblings that share a topic', async () => {
    const req = buildOrganizeBatchRequest({
      items: [
        { id: 'a', title: 'A', type: 'url', topics: ['inference'] },
        { id: 'b', title: 'B', type: 'pdf', topics: ['inference', 'gpu'] }
      ],
      candidates: [],
      collections: []
    })
    const { value } = await provider.generateStructured(organizePlanSchema, req)
    expect(value.relationships).toHaveLength(1)
    expect(value.relationships[0]).toMatchObject({ sourceId: 'a', targetId: 'b', type: 'related_to' })
  })

  it('produces empty ConsolidatePlan and a FolderUnderstanding', async () => {
    const consolidate = await provider.generateStructured(
      consolidatePlanSchema,
      buildConsolidateRequest({ collections: [], items: [] })
    )
    expect(consolidate.value.summary).toBe('Nothing to tidy up.')
    const folder = await provider.generateStructured(
      folderUnderstandingSchema,
      buildFolderRequest({
        title: 'brand-refresh',
        structure: { fileCount: 3, dirCount: 0, totalBytes: 10, extensions: { md: 2 } },
        samples: [
          { path: 'README.md', excerpt: 'Brand refresh working files' },
          { path: 'notes.md', excerpt: 'Type tests' }
        ]
      })
    )
    expect(folder.value.understanding.title).toBe('brand-refresh')
    expect(folder.value.keyFiles[0]?.path).toBe('README.md')
    expect(folder.value.collection).toBeNull()
  })
})

describe('mock provider tool flow', () => {
  const provider = createMockProvider({ logger })
  const search: ToolSpec = { type: 'function', function: { name: 'search_library', parameters: { type: 'object' } } }
  const finish = finishToolSpec(commandFinishSchema)

  it('searches first, then finishes with a schema-valid CommandFinish citing found ids', async () => {
    const messages = buildCommandMessages({ mode: 'ask', question: 'that mac app for window tiling I saved' })
    const step1 = await provider.chat({ messages, tools: [search, finish], toolChoice: 'auto', task: 'command' })
    expect(step1.finishReason).toBe('tool_calls')
    const call = step1.message.tool_calls?.[0]
    expect(call?.function.name).toBe('search_library')
    const args = repairToolArguments(call?.function.arguments ?? '')
    expect(args).toHaveProperty('value.query')

    const transcript = [
      ...messages,
      step1.message,
      {
        role: 'tool' as const,
        tool_call_id: call?.id ?? '',
        content: JSON.stringify([
          { id: 'item-1', title: 'Rectangle' },
          { id: 'item-2', title: 'Loop' }
        ])
      }
    ]
    const step2 = await provider.chat({
      messages: transcript,
      tools: [search, finish],
      toolChoice: 'auto',
      task: 'command'
    })
    expect(step2.message.tool_calls?.[0]?.function.name).toBe('finish')
    const payload = commandFinishSchema.parse(JSON.parse(step2.message.tool_calls?.[0]?.function.arguments ?? '{}'))
    expect(payload.kind).toBe('answer')
    expect(payload.sources.map((s) => s.itemId)).toEqual(['item-1', 'item-2'])
    expect(payload.answer).toContain('[1]')
  })

  it('finishes immediately when forced', async () => {
    const messages = buildCommandMessages({ mode: 'ask', question: 'anything about bread?' })
    const res = await provider.chat({ messages, ...forceFinish(finish), task: 'command' })
    expect(res.message.tool_calls?.[0]?.function.name).toBe('finish')
    const payload = commandFinishSchema.parse(JSON.parse(res.message.tool_calls?.[0]?.function.arguments ?? '{}'))
    expect(payload.sources).toEqual([])
    expect(payload.answer).toMatch(/Couldn't find anything/)
  })
})

describe('createAiProvider', () => {
  it('returns providers by mode and the off provider when unconfigured', async () => {
    expect(createAiProvider({ mode: 'mock', provider: 'gmi', logger }).id).toBe('mock')
    expect(createAiProvider({ mode: 'off', provider: 'gmi', logger }).id).toBe('off')
    expect(createAiProvider({ mode: 'gmi', provider: 'gmi', logger }).id).toBe('off')
    expect(
      createAiProvider({
        mode: 'gmi',
        provider: 'gmi',
        apiKey: 'k',
        logger,
        fetchImpl: async () => new Response('{}')
      }).id
    ).toBe('gmi')
    await expect(createOffProvider('gmi').chat({ messages: [] })).rejects.toSatisfy(
      (e: unknown) => isKaError(e) && e.code === 'AI_NOT_CONFIGURED'
    )
  })

  it('returns the unconfigured OpenRouter provider when key or model is missing', async () => {
    const off = createAiProvider({ mode: 'openrouter', provider: 'openrouter', logger })
    expect(off.id).toBe('off')
    await expect(off.chat({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toSatisfy(
      (e: unknown) => isKaError(e) && e.code === 'AI_NOT_CONFIGURED'
    )
    const configured = createAiProvider({
      mode: 'openrouter',
      provider: 'openrouter',
      apiKey: 'sk-or',
      model: 'openai/gpt-4o-mini',
      logger,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            id: 'or-1',
            choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1 }
          }),
          { status: 200 }
        )
    })
    expect(configured.id).toBe('openrouter')
  })
})
