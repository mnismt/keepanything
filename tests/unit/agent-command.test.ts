import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_TOOLS,
  type CommandAgentService,
  createAgentService,
  createRunMemory,
  dispatchTool,
  normalizeFinishArguments,
  testConnection
} from '../../src/main/agent'
import {
  commandFinishSchema,
  createHashEmbeddingProvider,
  createOffProvider,
  createScriptedProvider,
  type ScriptedProvider,
  textResponse,
  toolCallResponse
} from '../../src/main/ai'
import { KaError } from '../../src/main/core/errors'
import { silentLogger } from '../../src/main/lib/logger'
import type { AIProvider } from '../../src/main/ports'
import { createRetrieval, type RetrievalService } from '../../src/main/retrieval'
import type { AgentRunEvent } from '../../src/shared/ipc'
import type { Item } from '../../src/shared/types'
import { createHarness, type Harness } from './helpers/harness'

let h: Harness
let retrieval: RetrievalService
let contentDir: string

beforeEach(async () => {
  h = createHarness()
  retrieval = createRetrieval({
    db: h.db,
    repos: h.repos,
    embeddings: createHashEmbeddingProvider(),
    logger: silentLogger,
    clock: h.clock
  })
  await retrieval.warm()
  contentDir = mkdtempSync(join(tmpdir(), 'ka-agent-'))
})
afterEach(() => {
  h.close()
  rmSync(contentDir, { recursive: true, force: true })
})

function agentWith(
  provider: ScriptedProvider | (() => ScriptedProvider),
  opts: { maxSteps?: number } = {}
): CommandAgentService {
  return createAgentService({
    db: h.db,
    repos: h.repos,
    retrieval,
    ai: provider,
    items: h.items,
    collections: h.collections,
    relationships: h.relationships,
    audit: h.audit,
    events: h.events,
    clock: h.clock,
    logger: silentLogger,
    paths: { contentDir },
    queue: h.queue,
    ...(opts.maxSteps ? { maxSteps: opts.maxSteps } : {})
  })
}

async function seed(): Promise<{ vllm: Item; paged: Item; cake: Item }> {
  const make = async (input: Partial<Item> & { title: string }): Promise<Item> => {
    const item = h.item({ processingStatus: 'READY', ...input })
    await retrieval.indexItem(item.id)
    return item
  }
  const vllm = await make({
    type: 'url',
    subtype: 'github_repo',
    title: 'vllm-project/vllm',
    domain: 'github.com',
    understanding: 'High-throughput LLM serving engine built around PagedAttention.',
    topics: ['llm serving'],
    entities: ['vLLM'],
    extractedText: 'vLLM is a fast and easy-to-use library for LLM inference and serving. It uses PagedAttention.'
  })
  const paged = await make({
    type: 'pdf',
    title: 'PagedAttention paper',
    understanding: 'Paper behind vLLM memory management.',
    topics: ['llm serving'],
    entities: ['vLLM', 'PagedAttention']
  })
  const cake = await make({ title: 'Chocolate cake recipe', understanding: 'Baking.', topics: ['baking'] })
  return { vllm, paged, cake }
}

const events = (): AgentRunEvent[] => h.eventsNamed('agent.run')
const settled = async (agent: CommandAgentService): Promise<void> => {
  await vi.waitFor(() => expect(agent.activeRuns()).toHaveLength(0), { timeout: 2_000 })
}

describe('agent command loop', () => {
  it('searches, inspects, finishes; streams steps in order and persists the run', async () => {
    const { vllm, paged } = await seed()
    const provider = createScriptedProvider([
      toolCallResponse([{ name: 'search_library', args: { query: 'vllm serving', k: 5 } }]),
      toolCallResponse([
        { name: 'inspect_item', args: { ids: [vllm.id] } },
        { name: 'read_document', args: { id: vllm.id, maxChars: 300 } }
      ]),
      toolCallResponse([
        {
          name: 'finish',
          args: {
            kind: 'answer',
            answer: 'You kept the vLLM repo [1] and the PagedAttention paper [2].',
            sources: [
              { itemId: vllm.id, role: 'primary', why: 'The serving engine.' },
              { itemId: paged.id, role: 'supporting', why: 'The paper.' },
              { itemId: 'ghost', role: 'supporting', why: 'Made up.' }
            ],
            cues: { topics: ['vllm', 'serving'], types: ['url'] },
            confidence: 0.85
          }
        }
      ])
    ])
    const agent = agentWith(provider)
    const { runId } = await agent.command({ question: 'what did I save about vllm serving?' })
    expect(events()[0]).toMatchObject({ runId, task: 'command', status: 'running' })
    await settled(agent)

    const all = events()
    expect(all.map((e) => e.status)).toEqual(['running', 'running', 'running', 'running', 'running', 'succeeded'])
    // A read-only run wrote nothing, so there is nothing to undo.
    expect(all.at(-1)?.undoable).toBe(false)
    expect(all.slice(1, 5).map((e) => e.step?.label)).toEqual([
      'Searching your library for “vllm serving”',
      'Looking at “vllm-project/vllm”',
      'Reading “vllm-project/vllm”',
      'Writing the answer'
    ])
    const result = all[5]?.result
    expect(result?.task).toBe('command')
    if (result?.task !== 'command') throw new Error('unreachable')
    expect(result.kind).toBe('answer')
    expect(result.answer).toContain('vLLM repo [1]')
    expect(result.sources.map((s) => s.itemId)).toEqual([vllm.id, paged.id])
    expect(result.cues).toEqual({ topics: ['vllm', 'serving'], types: ['url'] })

    const persisted = h.repos.agentRuns.get(runId)
    expect(persisted).toMatchObject({ status: 'succeeded', task: 'command', stepCount: 4 })
    expect(persisted?.usage?.calls).toBe(3)
    expect(JSON.stringify(persisted?.steps)).not.toMatch(/PagedAttention paper behind/)

    // Prompt discipline: system + tools first and identical across calls, parallel calls answered in order.
    const [first, second, third] = provider.calls
    expect(first?.messages[0]).toEqual(second?.messages[0])
    expect(first?.tools?.map((t) => t.function.name)).toEqual([...AGENT_TOOLS.map((t) => t.function.name), 'finish'])
    expect(second?.tools).toEqual(first?.tools)
    const toolReplies = third?.messages.filter((m) => m.role === 'tool') ?? []
    expect(toolReplies.map((m) => (m as { tool_call_id: string }).tool_call_id)).toEqual(['call_1', 'call_1', 'call_2'])
    expect(agent.getRun(runId)?.status).toBe('succeeded')
  })

  it('records rejected steps for unknown tools and bad arguments, then still finishes', async () => {
    await seed()
    const provider = createScriptedProvider([
      toolCallResponse([
        { name: 'delete_everything', args: {} },
        { name: 'read_document', args: '{"id": ' }
      ]),
      toolCallResponse([
        { name: 'finish', args: { kind: 'answer', answer: 'Nothing found.', sources: [], cues: {}, confidence: 0.2 } }
      ])
    ])
    const agent = agentWith(provider)
    await agent.command({ question: 'anything?' })
    await settled(agent)
    const steps = events()
      .map((e) => e.step)
      .filter((s) => s !== undefined)
    expect(steps.map((s) => s.status)).toEqual(['rejected', 'rejected', 'ok'])
    expect(steps[0]?.rejectReason).toMatch(/Unknown tool/)
    const toolReply = provider.calls[1]?.messages.find((m) => m.role === 'tool')
    expect((toolReply as { content: string }).content).toMatch(/Available:/)
    const result = events().at(-1)?.result
    expect(result && result.task === 'command' && result.sources).toEqual([])
  })

  it('nudges prose without a tool call once, then forces finish on the last step', async () => {
    await seed()
    const provider = createScriptedProvider([
      textResponse('Here is my answer in prose.'),
      toolCallResponse([{ name: 'search_library', args: { query: 'a' } }]),
      toolCallResponse([{ name: 'search_library', args: { query: 'b' } }]),
      toolCallResponse([
        { name: 'finish', args: { kind: 'answer', answer: 'Done.', sources: [], cues: {}, confidence: 0.4 } }
      ])
    ])
    const agent = agentWith(provider, { maxSteps: 3 })
    await agent.command({ question: 'what is here?' })
    await settled(agent)
    expect(events().at(-1)?.status).toBe('succeeded')
    expect(provider.calls[1]?.toolChoice).toBe('required')
    const messages1 = provider.calls[1]?.messages ?? []
    expect(JSON.stringify(messages1)).toMatch(/plain text is not delivered/)
    const last = provider.calls[3]
    expect(last?.tools?.map((t) => t.function.name)).toEqual(['finish'])
    expect(last?.toolChoice).toBe('required')
    expect(JSON.stringify(last?.messages)).toMatch(/Call finish now/)
  })

  it('charges the model wait to the step it produced, carrying rounds that recorded nothing', async () => {
    await seed()
    const scripted = createScriptedProvider([
      textResponse('Here is my answer in prose.'),
      toolCallResponse([{ name: 'search_library', args: { query: 'vllm' } }]),
      toolCallResponse([
        { name: 'finish', args: { kind: 'answer', answer: 'Done.', sources: [], cues: {}, confidence: 0.4 } }
      ])
    ])
    const wait = 15
    const provider: ScriptedProvider = {
      ...scripted,
      chat: async (req) => {
        await new Promise((r) => setTimeout(r, wait))
        return scripted.chat(req)
      }
    }
    const agent = agentWith(provider)
    await agent.command({ question: 'what did I save about vllm?' })
    await settled(agent)
    const steps = events()
      .map((e) => e.step)
      .filter((s) => s !== undefined)
    expect(steps.map((s) => s.tool)).toEqual(['search_library', 'finish'])
    // The nudged round recorded no step, so its wait carries into the search step.
    expect(steps[0]?.durationMs).toBeGreaterThanOrEqual(wait * 2)
    expect(steps[1]?.durationMs).toBeGreaterThanOrEqual(wait)
  })

  it('fails cleanly when finish is invalid twice and when the provider is not configured', async () => {
    await seed()
    const bad = toolCallResponse([{ name: 'finish', args: { kind: 'answer', sources: [] } }])
    const provider = createScriptedProvider([bad, bad])
    const agent = agentWith(provider)
    const { runId } = await agent.command({ question: 'hm?' })
    await settled(agent)
    const last = events().at(-1)
    expect(last?.status).toBe('failed')
    expect(last?.error?.code).toBe('AI_UNAVAILABLE')
    expect(h.repos.agentRuns.get(runId)?.status).toBe('failed')

    const off = createAgentService({
      repos: h.repos,
      ai: createOffProvider('gmi'),
      items: h.items,
      collections: h.collections,
      relationships: h.relationships,
      retrieval,
      audit: h.audit,
      events: h.events,
      clock: h.clock,
      logger: silentLogger,
      paths: { contentDir }
    })
    const second = await off.command({ question: 'hello?' })
    await vi.waitFor(() => expect(off.activeRuns()).toHaveLength(0))
    const ev = events()
      .filter((e) => e.runId === second.runId)
      .at(-1)
    expect(ev?.status).toBe('failed')
    expect(ev?.error?.code).toBe('AI_NOT_CONFIGURED')
    await expect(off.command({ question: '   ' })).rejects.toBeInstanceOf(KaError)
  })

  it('cancels a run in flight', async () => {
    await seed()
    let seen = 0
    const provider: AIProvider = {
      id: 'blocking',
      model: 'blocking',
      chat: (req) =>
        new Promise((_resolve, reject) => {
          seen++
          req.signal?.addEventListener('abort', () => reject(new KaError('CANCELLED', 'The request was cancelled.')), {
            once: true
          })
        }),
      generateStructured: () => Promise.reject(new Error('unused'))
    }
    const agent = agentWith(provider as ScriptedProvider)
    const { runId } = await agent.command({ question: 'slow?' })
    await vi.waitFor(() => expect(seen).toBe(1))
    agent.cancel(runId)
    await settled(agent)
    expect(events().at(-1)).toMatchObject({ runId, status: 'cancelled', error: { code: 'CANCELLED' } })
    expect(h.repos.agentRuns.get(runId)?.status).toBe('cancelled')
  })

  it('creates a note with sources and created_from links for kind "note" templates', async () => {
    const { vllm, paged } = await seed()
    const provider = createScriptedProvider([
      toolCallResponse([{ name: 'inspect_item', args: { ids: [vllm.id, paged.id] } }]),
      toolCallResponse([
        {
          name: 'finish',
          args: {
            kind: 'note',
            noteTitle: 'vLLM vs PagedAttention',
            noteMarkdown: '# vLLM vs PagedAttention\n\nThe repo [1] implements the paper [2].',
            sources: [
              { itemId: vllm.id, role: 'primary', why: 'Engine.' },
              { itemId: paged.id, role: 'primary', why: 'Paper.' }
            ],
            cues: { topics: ['serving'] },
            confidence: 0.9
          }
        }
      ])
    ])
    const agent = agentWith(provider)
    const { runId } = await agent.command({ question: '', itemIds: [vllm.id, paged.id], template: 'compare' })
    await settled(agent)
    const result = events().at(-1)?.result
    if (result?.task !== 'command') throw new Error('no result')
    expect(result.kind).toBe('note')
    const note = h.repos.items.get(result.noteId as string)
    expect(note).toMatchObject({
      type: 'note',
      title: 'vLLM vs PagedAttention',
      kind: 'note',
      processingStatus: 'CAPTURED'
    })
    expect(note?.metadata.sources).toHaveLength(2)
    expect(readFileSync(join(contentDir, note?.managedPath as string), 'utf8')).toContain('implements the paper')
    expect(h.repos.relationships.forItem(note?.id as string).map((r) => r.type)).toEqual([
      'created_from',
      'created_from'
    ])
    expect(
      h.repos.jobs
        .activeForItem(note?.id as string)
        .map((j) => j.stage)
        .sort()
    ).toEqual(['embed', 'index'])
    expect(JSON.stringify(provider.calls[0]?.messages)).toMatch(/Compare these items/)
    expect(events().at(-1)?.undoable).toBe(true)
    expect(h.repos.agentRuns.get(runId)?.undoable).toBe(true)
    // Undo the whole run: note trashed, links removed.
    expect(agent.undoRun(runId)).toBe(3)
    expect(h.repos.items.get(note?.id as string)?.deletedAt).not.toBeNull()
    expect(h.repos.relationships.forItem(note?.id as string)).toHaveLength(0)
    expect(h.repos.agentRuns.get(runId)?.undoable).toBe(false)
    expect(agent.undoRun(runId)).toBe(0)
  })

  it('stages proposals, applies them on approval with audit rows, and undoes them', async () => {
    const { vllm, paged, cake } = await seed()
    const collection = h.collections.create({ name: 'LLM serving research', description: 'd', createdBy: 'user' })
    const provider = createScriptedProvider([
      toolCallResponse([{ name: 'list_collections', args: {} }]),
      toolCallResponse([
        {
          name: 'propose_actions',
          args: {
            actions: [
              {
                kind: 'add_to_collection',
                collectionId: collection.id,
                itemId: vllm.id,
                reason: 'Serving engine.',
                confidence: 0.9
              },
              {
                kind: 'relate',
                sourceId: vllm.id,
                targetId: paged.id,
                type: 'references',
                description: 'Implements.',
                confidence: 0.9
              },
              { kind: 'trash', itemId: cake.id, reason: 'Off topic.', confidence: 0.9 },
              { kind: 'rename', itemId: 'ghost', title: 'x', confidence: 0.9 }
            ]
          }
        }
      ]),
      toolCallResponse([
        {
          name: 'finish',
          args: {
            kind: 'answer',
            answer: 'Organized.',
            sources: [{ itemId: vllm.id, role: 'primary', why: 'w' }],
            cues: {},
            confidence: 0.9
          }
        }
      ])
    ])
    const agent = agentWith(provider)
    const { runId } = await agent.command({ question: 'tidy up my serving stuff' })
    await settled(agent)
    const last = events().at(-1)
    const result = last?.result
    if (result?.task !== 'command') throw new Error('no result')
    // Proposals are structured on the result, not appended to the answer text.
    expect(result.answer).toBe('Organized.')
    expect(result.appliedCount).toBeUndefined()
    expect(last?.undoable).toBe(false)
    expect(result.proposals?.map((p) => p.kind)).toEqual(['add_to_collection', 'relate', 'trash'])
    expect(result.proposals?.[2]?.label).toBe('move “Chocolate cake recipe” to the Trash')
    expect(result.proposals?.[0]).toMatchObject({
      kind: 'add_to_collection',
      collectionId: collection.id,
      itemId: vllm.id,
      label: `add “vllm-project/vllm” to “${collection.name}”`
    })
    expect(agent.proposals(runId)).toHaveLength(3)
    expect(h.repos.collections.members(collection.id)).toHaveLength(0)
    // Persisted with the run, so approval survives a restart (a fresh service reads the row).
    const persisted = h.repos.agentRuns.get(runId)?.result
    expect(persisted?.task === 'command' && persisted.proposals).toHaveLength(3)
    const afterRestart = agentWith(provider)
    expect(afterRestart.proposals(runId)).toHaveLength(3)

    const applied = afterRestart.applyProposals(runId)
    expect(applied).toEqual({ applied: 3, remaining: [] })
    expect(h.repos.collections.getMember(collection.id, vllm.id)?.agentRunId).toBe(runId)
    expect(h.repos.relationships.forItem(vllm.id)).toHaveLength(1)
    expect(h.repos.items.get(cake.id)?.deletedAt).not.toBeNull()
    expect(afterRestart.proposals(runId)).toEqual([])
    expect(agent.proposals(runId)).toEqual([])
    const persistedAfter = h.repos.agentRuns.get(runId)
    expect(persistedAfter?.result?.task === 'command' && persistedAfter.result.proposals).toEqual([])
    expect(persistedAfter?.result?.task === 'command' && persistedAfter.result.appliedCount).toBe(3)
    expect(persistedAfter?.undoable).toBe(true)
    expect(afterRestart.applyProposals(runId)).toEqual({ applied: 0, remaining: [] })
    const audit = h.repos.audit
      .forRun(runId)
      .map((e) => e.action)
      .sort()
    expect(audit).toEqual(['add_to_collection', 'create_relationship'])

    expect(agent.undoRun(runId)).toBe(2)
    expect(h.repos.agentRuns.get(runId)?.undoable).toBe(false)
    expect(h.repos.collections.members(collection.id)).toHaveLength(0)
    expect(h.repos.relationships.forItem(vllm.id)).toHaveLength(0)
    expect(h.repos.suppressions.has('collection_member', `${collection.id}:${vllm.id}`)).toBe(true)
  })
})

describe('tool handlers', () => {
  it('topic_overview aggregates topics and kinds; inspect_item rejects unknown ids', async () => {
    const { vllm } = await seed()
    const memory = createRunMemory()
    const env = { retrieval, repos: h.repos, clock: h.clock, readContent: async () => null }
    const overview = await dispatchTool('topic_overview', '{"limit": 5}', env, memory)
    const payload = JSON.parse(overview.content) as {
      items: number
      kinds: Record<string, number>
      topics: { topic: string; count: number }[]
    }
    expect(payload.items).toBe(3)
    expect(payload.topics[0]).toMatchObject({ topic: 'llm serving', count: 2 })
    expect(memory.seen.has(vllm.id)).toBe(true)
    expect(overview.step.label).toBe('Getting an overview of your library')
    const none = await dispatchTool('inspect_item', '{"ids": ["nope"]}', env, memory)
    expect(none.step.status).toBe('rejected')
    expect(none.content).toMatch(/No such items/)
  })
})

describe('normalizeFinishArguments', () => {
  it('accepts the loose shapes MiniMax produces live', () => {
    const loose = {
      kind: 'answer',
      answer: 'x',
      sources: ['a1', { itemId: 'b2', role: 'primary', why: 'w' }],
      cues: { topics: 'inference', types: 'url', timeframe: 'the last few weeks' },
      confidence: '80%'
    }
    const parsed = commandFinishSchema.parse(normalizeFinishArguments(loose))
    expect(parsed.cues).toEqual({ topics: ['inference'], types: ['url'], timeframe: { label: 'the last few weeks' } })
    expect(parsed.sources.map((s) => s.itemId)).toEqual(['a1', 'b2'])
    expect(parsed.confidence).toBe(0.8)
    expect(
      commandFinishSchema.parse(
        normalizeFinishArguments({ kind: 'answer', answer: 'y', cues: ['a', 'b'], confidence: 0.5 })
      ).cues.topics
    ).toEqual(['a', 'b'])
  })
})

describe('testConnection', () => {
  it('reports ok with model and latency, or a user-safe error', async () => {
    const ok = await testConnection(createScriptedProvider([textResponse('OK')]), {
      now: (() => {
        let t = 0
        return () => (t += 12)
      })()
    })
    expect(ok).toEqual({ ok: true, model: 'scripted', latencyMs: 12 })
    const off = await testConnection(createOffProvider('gmi'))
    expect(off.ok).toBe(false)
    const agent = agentWith(createScriptedProvider([textResponse('OK')]))
    expect((await agent.testConnection()).ok).toBe(true)
  })
})
