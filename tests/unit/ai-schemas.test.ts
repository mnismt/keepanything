import { describe, expect, it } from 'vitest'
import { messageText } from '../../src/main/ai/messages'
import {
  buildCommandMessages,
  buildConsolidateMessages,
  buildFolderMessages,
  buildOrganizeBatchMessages,
  buildOrganizeMessages,
  buildUnderstandMessages,
  COLLECTION_RULES,
  COMMAND_SYSTEM_PROMPT,
  FINISH_TOOL_NAME,
  finishToolSpec,
  forceFinish,
  ORGANIZE_SYSTEM_PROMPT,
  UNDERSTAND_SYSTEM_PROMPT
} from '../../src/main/ai/prompts'
import {
  commandFinishSchema,
  consolidatePlanSchema,
  folderUnderstandingSchema,
  organizePlanSchema,
  understandingSchema
} from '../../src/main/ai/schemas'
import { KINDS } from '../../src/shared/kinds'

const understandingSample = {
  kind: 'macos_app',
  title: 'Rectangle — window management for macOS',
  summary: 'Open-source macOS utility that snaps windows to halves, thirds and corners with keyboard shortcuts.',
  whyUseful: 'Reference for a lightweight window tiler when setting up a new Mac.',
  topics: ['window management', 'macos utilities', 'keyboard shortcuts'],
  entities: ['Rectangle', 'GitHub'],
  retrievalHints: ['that mac app for window tiling', 'rectangle window snap', 'macos window manager'],
  confidence: 0.86
}

describe('understandingSchema', () => {
  it('round-trips a valid sample', () => {
    const value = understandingSchema.parse(understandingSample)
    expect(value).toEqual(understandingSample)
    expect(value.visualDescription).toBeUndefined()
  })

  it('normalises enums, coerces numbers, drops unknown actions and caps lists', () => {
    const value = understandingSchema.parse({
      ...understandingSample,
      kind: ' macOS-App ',
      confidence: '85%',
      topics: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'A'],
      visualDescription: '  ',
      visibleText: 'Total $12.40'
    })
    expect(value.kind).toBe('macos_app')
    expect(value.confidence).toBe(0.85)
    expect(value.topics).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(value.visualDescription).toBeUndefined()
    expect(value.visibleText).toBe('Total $12.40')
  })

  it('rejects an unknown kind and an empty title', () => {
    expect(() => understandingSchema.parse({ ...understandingSample, kind: 'website' })).toThrow()
    expect(() => understandingSchema.parse({ ...understandingSample, title: '' })).toThrow()
  })

  it('publishes a JSON schema with the closed vocabularies', () => {
    const json = understandingSchema.jsonSchema as {
      properties: Record<string, { enum?: string[]; items?: { enum?: string[] } }>
    }
    expect(json.properties.kind?.enum).toEqual([...KINDS])
    expect(understandingSchema.jsonSchema).not.toHaveProperty('$schema')
  })
})

describe('organizePlanSchema', () => {
  it('round-trips and fills defaults', () => {
    const plan = organizePlanSchema.parse({
      relationships: [
        { sourceId: 'a', targetId: 'b', type: 'Alternative To', description: 'Both tile windows.', confidence: 0.8 }
      ],
      summary: 'Linked to 1 thing.',
      confidence: 0.7
    })
    expect(plan.relationships[0]?.type).toBe('alternative_to')
    expect(plan.addToCollections).toEqual([])
    expect(plan.newCollections).toEqual([])
    expect(plan.understandingPatches).toEqual([])
  })

  it('accepts a full plan with collections', () => {
    const plan = organizePlanSchema.parse({
      relationships: [],
      addToCollections: [{ collectionId: 'c1', itemId: 'a', confidence: 0.9, reason: 'Same project.' }],
      newCollections: [
        {
          name: 'Local LLM inference research',
          description:
            'Articles, repos and papers about serving open models locally: batching, KV cache, quantisation.',
          members: [
            { itemId: 'a', reason: 'vLLM paper' },
            { itemId: 'b', reason: 'llama.cpp repo' },
            { itemId: 'c', reason: 'batching article' }
          ],
          confidence: 0.75
        }
      ],
      summary: 'This looks like part of your inference research.',
      confidence: 0.8
    })
    expect(plan.newCollections[0]?.members).toHaveLength(3)
  })

  it('rejects an unknown relationship type', () => {
    expect(() =>
      organizePlanSchema.parse({
        relationships: [{ sourceId: 'a', targetId: 'b', type: 'similar', description: 'x', confidence: 0.5 }],
        summary: 's',
        confidence: 0.5
      })
    ).toThrow()
  })
})

describe('consolidatePlanSchema', () => {
  it('round-trips an empty plan and a full one', () => {
    expect(consolidatePlanSchema.parse({ summary: 'Nothing to tidy up.', confidence: 0.9 })).toMatchObject({
      renames: [],
      merges: [],
      summary: 'Nothing to tidy up.'
    })
    const plan = consolidatePlanSchema.parse({
      renames: [
        {
          collectionId: 'c1',
          name: 'MiniMax Hackathon',
          description: 'Everything for the hackathon build.',
          reason: 'Members are all hackathon material.'
        }
      ],
      merges: [{ fromCollectionId: 'c2', intoCollectionId: 'c1', reason: 'Same context.' }],
      summary: 'Renamed one collection and merged two.',
      confidence: 0.7
    })
    expect(plan.renames).toHaveLength(1)
    expect(plan.merges).toHaveLength(1)
  })
})

describe('folderUnderstandingSchema', () => {
  it('round-trips with nested understanding and nullable collection', () => {
    const value = folderUnderstandingSchema.parse({
      understanding: { ...understandingSample, kind: 'other' },
      purpose: 'Working files for the mnismt brand refresh.',
      keyFiles: [{ path: 'brief.md', why: 'The brief.' }],
      collection: {
        name: 'mnismt visual direction',
        description: 'Brand exploration files, moodboards and type tests for the mnismt refresh.',
        confidence: 0.7
      }
    })
    expect(value.understanding.kind).toBe('other')
    expect(value.collection?.name).toBe('mnismt visual direction')
    const bare = folderUnderstandingSchema.parse({ understanding: understandingSample, purpose: 'p' })
    expect(bare.collection).toBeNull()
    expect(bare.keyFiles).toEqual([])
  })
})

describe('commandFinishSchema', () => {
  it('round-trips an answer with sources and cues', () => {
    const value = commandFinishSchema.parse({
      kind: 'answer',
      answer: 'Rectangle [1] and Loop [2] both tile windows.',
      sources: [
        { itemId: 'a', role: 'primary', why: 'The app asked about.' },
        { itemId: 'b', why: 'Alternative.' }
      ],
      cues: { topics: ['window tiling'], types: ['URL'], timeframe: { label: 'a few weeks ago' } },
      confidence: 0.8
    })
    expect(value.sources[1]?.role).toBe('supporting')
    expect(value.cues.types).toEqual(['url'])
    expect(value.cues.timeframe?.label).toBe('a few weeks ago')
  })

  it('requires answer for answers and noteMarkdown for notes', () => {
    expect(() => commandFinishSchema.parse({ kind: 'answer', sources: [], confidence: 0.5 })).toThrow(
      /answer is required/
    )
    expect(() => commandFinishSchema.parse({ kind: 'note', sources: [], confidence: 0.5 })).toThrow(/noteMarkdown/)
    const note = commandFinishSchema.parse({
      kind: 'note',
      noteTitle: 'T',
      noteMarkdown: '# T\n\nBody [1]',
      sources: [],
      confidence: 0.5
    })
    expect(note.cues).toEqual({ topics: [], types: [], timeframe: undefined })
  })

  it('becomes the finish tool parameters', () => {
    const spec = finishToolSpec(commandFinishSchema)
    expect(spec.function.name).toBe(FINISH_TOOL_NAME)
    expect(spec.function.parameters).toBe(commandFinishSchema.jsonSchema)
    expect(forceFinish(spec)).toEqual({ tools: [spec], toolChoice: 'required' })
  })
})

describe('prompt builders', () => {
  it('keep system prompts byte-stable and state the collection rules', () => {
    const a = buildUnderstandMessages({ title: 'A', type: 'url', text: 'x' })
    const b = buildUnderstandMessages({ title: 'B', type: 'pdf', text: 'y' })
    expect(a[0]).toEqual(b[0])
    expect(messageText(a[0] ?? { role: 'user', content: '' })).toBe(UNDERSTAND_SYSTEM_PROMPT)
    expect(ORGANIZE_SYSTEM_PROMPT).toContain(COLLECTION_RULES)
    expect(COLLECTION_RULES).toMatch(/at least 3 members/)
    expect(UNDERSTAND_SYSTEM_PROMPT).toContain(KINDS.join(' | '))
    expect(UNDERSTAND_SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/)
    expect(COMMAND_SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  it('renders understand input with images as multimodal parts and vision instructions', () => {
    const messages = buildUnderstandMessages({
      title: 'Shot',
      type: 'image',
      subtype: 'screenshot',
      images: ['data:image/png;base64,AAAA', 'https://example.com/not-allowed.png'],
      capturedAt: '2026-09-03T00:00:00Z'
    })
    const userMsg = messages[1]
    expect(Array.isArray(userMsg?.content)).toBe(true)
    const parts = userMsg?.content as { type: string }[]
    expect(parts.map((p) => p.type)).toEqual(['text', 'image_url'])
    expect(messageText(userMsg ?? { role: 'user', content: '' })).toContain('Type: image/screenshot')
    expect(messageText(userMsg ?? { role: 'user', content: '' })).toContain('Attached: one image')
  })

  it('caps understand text', () => {
    const messages = buildUnderstandMessages({ title: 'Long', type: 'text', text: 'x'.repeat(20_000) })
    const text = messageText(messages[1] ?? { role: 'user', content: '' })
    expect(text).toContain('truncated')
    expect(text.length).toBeLessThan(13_000)
  })

  it('renders organize, batch, consolidate, folder and command inputs', () => {
    const organize = buildOrganizeMessages({
      item: { id: 'a', title: 'A', type: 'url', topics: ['x'] },
      candidates: [{ id: 'b', title: 'B', type: 'url', cosine: 0.7 }],
      collections: [{ id: 'c', name: 'Ongoing thing', count: 3, createdBy: 'agent' }],
      userFacts: ['A is in "Ongoing thing" (added by the person).'],
      suppressed: ['A related_to B']
    })
    const text = messageText(organize[1] ?? { role: 'user', content: '' })
    expect(text).toContain('New item (JSON):')
    expect(text).toContain('never propose again')
    const batch = buildOrganizeBatchMessages({
      items: [
        { id: 'a', title: 'A', type: 'url' },
        { id: 'b', title: 'B', type: 'pdf' }
      ],
      candidates: [],
      collections: []
    })
    expect(messageText(batch[1] ?? { role: 'user', content: '' })).toContain('New items kept together (2)')
    const consolidate = buildConsolidateMessages({ collections: [], items: [] })
    expect(messageText(consolidate[1] ?? { role: 'user', content: '' })).toContain('An empty plan is a valid answer.')
    const folder = buildFolderMessages({
      title: 'brand',
      structure: {
        fileCount: 3,
        dirCount: 1,
        totalBytes: 100,
        extensions: { md: 2, png: 1 },
        tree: 'brand/\n  brief.md'
      },
      samples: [{ path: 'brief.md', excerpt: 'The brief' }]
    })
    expect(messageText(folder[1] ?? { role: 'user', content: '' })).toContain('--- brief.md')
    const ask = buildCommandMessages({ mode: 'ask', question: 'that mac app I saved?', today: '2026-09-03' })
    expect(messageText(ask[1] ?? { role: 'user', content: '' })).toContain('Question: that mac app I saved?')
    const template = buildCommandMessages({
      mode: 'template',
      template: 'compare',
      seeds: [{ id: 'a', title: 'A', type: 'url' }]
    })
    expect(messageText(template[1] ?? { role: 'user', content: '' })).toContain('Compare these items')
  })

  it('appends prior turns and the new question to the ask transcript', () => {
    const messages = buildCommandMessages({
      mode: 'ask',
      question: 'follow-up',
      today: '2026-09-05',
      history: [
        { role: 'user', content: 'first question' },
        { role: 'assistant', content: 'first answer' }
      ]
    })
    expect(messages).toHaveLength(4)
    expect(messages[0]?.role).toBe('system')
    expect(messages[1]).toEqual({ role: 'user', content: 'first question' })
    expect(messages[2]).toEqual({ role: 'assistant', content: 'first answer' })
    expect(messages[3]?.role).toBe('user')
    expect(messageText(messages[3] ?? { role: 'user', content: '' })).toContain('Question: follow-up')
  })

  it('truncates overly long prior turns and skips empty ones', () => {
    const long = 'x'.repeat(5_000)
    const messages = buildCommandMessages({
      mode: 'ask',
      question: 'next',
      history: [
        { role: 'user', content: long },
        { role: 'assistant', content: '   ' },
        { role: 'user', content: 'kept' }
      ]
    })
    expect(messages).toHaveLength(4)
    const userOne = messages[1]
    if (userOne?.role !== 'user') throw new Error('expected user')
    const content = userOne.content
    if (typeof content !== 'string') throw new Error('expected string content')
    expect(content.endsWith('…')).toBe(true)
    expect(content.length).toBeLessThanOrEqual(2_001)
  })

  it('ignores history for non-ask modes', () => {
    const messages = buildCommandMessages({
      mode: 'template',
      template: 'compare',
      seeds: [{ id: 'a', title: 'A', type: 'url' }],
      // history is structurally invalid for templates; the runtime never sets it,
      // but buildCommandMessages must not crash if a caller did.
      history: [{ role: 'user', content: 'noop' }]
    } as unknown as Parameters<typeof buildCommandMessages>[0])
    expect(messages).toHaveLength(2)
  })
})
