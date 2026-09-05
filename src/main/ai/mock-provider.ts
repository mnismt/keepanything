import { KIND_LABEL, type Kind } from '../../shared/kinds'
import type { Understanding } from '../../shared/types'
import type { AIProvider, ChatMessage, ChatRequest, ChatResponse, Logger, ToolCall, Usage } from '../ports'
import { estimateTokens, hasImages, lastUserIndex, messageText } from './messages'
import type { CommandFinish } from './schemas/command'
import type { ConsolidatePlan } from './schemas/consolidate'
import type { FolderUnderstanding } from './schemas/folder'
import type { OrganizePlan, RelationshipProposal } from './schemas/organize'
import { withStructured } from './structured'

export interface MockProviderOptions {
  logger?: Logger
  /** Reported `usage.latencyMs` (no real delay). */
  latencyMs?: number
}

const MODEL = 'mock-minimax'

const STOPWORDS = new Set(
  (
    'a an the and or but if then else of to in on at by for with from as is are was were be been being this that these those ' +
    "it its it's into over under about after before between during through up down out off again further once here there " +
    'when where why how all any both each few more most other some such no nor not only own same so than too very can will ' +
    'just should now you your yours we our ours they them their he she his her i me my mine what which who whom whose have has ' +
    'had do does did done also via using use used new one two three like get got make made per may might must shall would ' +
    'could title type url domain mime captured content metadata json children attached image images item items candidates ' +
    'existing collections question today action instruction selected read finish kind note answer https http www com'
  ).split(/\s+/)
)

/** Lower-cased words ≥ 3 chars minus stopwords, in order of first appearance. */
export function keywords(text: string, max = 6): string[] {
  const counts = new Map<string, number>()
  const order: string[] = []
  for (const raw of text.toLowerCase().split(/[^a-z0-9+#.-]+/)) {
    const word = raw.replace(/^[.-]+|[.-]+$/g, '')
    if (word.length < 3 || STOPWORDS.has(word) || /^\d+$/.test(word)) continue
    if (!counts.has(word)) order.push(word)
    counts.set(word, (counts.get(word) ?? 0) + 1)
  }
  return order
    .map((word, index) => ({ word, index, count: counts.get(word) ?? 0 }))
    .sort((a, b) => b.count - a.count || a.index - b.index)
    .slice(0, max)
    .map((entry) => entry.word)
}

/** Capitalised tokens (products, people, companies) in order, de-duplicated. */
export function entities(text: string, max = 8): string[] {
  const out: string[] = []
  for (const match of text.matchAll(/\b([A-Z][A-Za-z0-9]+(?:[ -][A-Z][A-Za-z0-9]+)*)\b/g)) {
    const value = match[1] ?? ''
    if (value.length < 3 || STOPWORDS.has(value.toLowerCase()) || out.includes(value)) continue
    out.push(value)
    if (out.length === max) break
  }
  return out
}

const CONTRACT_MARKER = '\nRespond with a single JSON object'

/** The user text without the structured-output contract `generateStructured` appends. */
function stripContract(text: string): string {
  const index = text.indexOf(CONTRACT_MARKER)
  return index === -1 ? text : text.slice(0, index)
}

function lastUserText(messages: ChatMessage[]): string {
  return stripContract(messageText(messages[lastUserIndex(messages)] ?? { role: 'user', content: '' }))
}

function field(text: string, name: string): string | null {
  const match = new RegExp(`^${name}: (.*)$`, 'm').exec(text)
  return match?.[1]?.trim() || null
}

function jsonField<T>(text: string, label: string): T | null {
  const marker = `${label} (JSON):\n`
  const start = text.indexOf(marker)
  if (start === -1) return null
  const from = start + marker.length
  const end = text.indexOf('\n', from)
  const raw = text.slice(from, end === -1 ? undefined : end)
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function guessKind(type: string, subtype: string | null, domain: string | null, text: string): Kind {
  const lower = text.toLowerCase()
  const host = (domain ?? '').toLowerCase()
  if (/receipt|invoice|order (confirmation|#)|total:|amount due|subtotal/.test(lower)) return 'receipt'
  if (host.includes('github.com') || subtype === 'github_repo') {
    if (/\bcli\b|command[- ]line|terminal/.test(lower)) return 'cli_tool'
    if (/macos app|mac app|menu bar|\.app\b|for mac/.test(lower)) return 'macos_app'
    return 'library'
  }
  if (host.includes('youtube') || host.includes('vimeo') || type === 'video' || subtype === 'youtube') return 'video'
  if (/twitter\.com|x\.com|reddit|threads\.net|mastodon|bsky/.test(host) || subtype === 'tweet' || subtype === 'social')
    return 'social_post'
  if (host.includes('arxiv') || subtype === 'paper' || /\babstract\b[\s\S]{0,400}\bintroduction\b/.test(lower))
    return 'paper'
  if (/figma|dribbble|behance|awwwards/.test(host) || subtype === 'figma' || subtype === 'design')
    return 'design_reference'
  if (subtype === 'docs' || /^docs\.|readthedocs|\/docs\//.test(host) || /api reference|documentation/.test(lower))
    return 'docs'
  if (type === 'image') return subtype === 'screenshot' ? 'screenshot' : 'photo'
  if (type === 'note') return 'note'
  if (/\.csv\b|dataset|kaggle|huggingface\.co\/datasets/.test(lower)) return 'dataset'
  if (/mac app store|apps\.apple\.com|for macos|menu bar app|macos utility/.test(lower)) return 'macos_app'
  if (/\bnpm install\b|\bpip install\b|\bcargo add\b|\bsdk\b/.test(lower)) return 'library'
  if (/pricing|sign up|free trial|start for free/.test(lower) && type === 'url') return 'saas_product'
  if (type === 'url' || type === 'pdf' || type === 'markdown' || type === 'text') return 'article'
  return 'other'
}

/** Deterministic understanding from the understand prompt text. */
export function mockUnderstanding(userText: string, withImage: boolean): Understanding {
  const title = field(userText, 'Title') ?? field(userText, 'Folder') ?? 'Untitled'
  const typeField = field(userText, 'Type') ?? 'unknown'
  const [type = 'unknown', subtype = null] = typeField.split('/') as [string, string | null]
  const domain = field(userText, 'Domain')
  const contentIndex = userText.indexOf('\nContent:')
  const content = contentIndex === -1 ? '' : userText.slice(contentIndex + 9).trim()
  const kind = guessKind(type, subtype, domain, `${title}\n${content}`)
  const topics = keywords(`${title} ${title} ${content.slice(0, 4_000)}`, 6)
  const names = entities(`${title}\n${content.slice(0, 2_000)}`)
  const label = KIND_LABEL[kind].toLowerCase()
  const firstSentence = content.split(/(?<=[.!?])\s+/)[0]?.slice(0, 160) ?? ''
  const summary =
    content.length > 0
      ? `${label[0]?.toUpperCase()}${label.slice(1)} titled "${title}". ${firstSentence}`.trim()
      : `${label[0]?.toUpperCase()}${label.slice(1)} titled "${title}"${domain ? ` from ${domain}` : ''}.`
  const hints = [title.toLowerCase(), `${label} about ${topics[0] ?? title.toLowerCase()}`]
  if (domain) hints.push(domain.replace(/^www\./, ''))
  if (topics[1]) hints.push(`${topics[0]} ${topics[1]}`)
  const understanding: Understanding = {
    kind,
    title: title.slice(0, 160),
    summary,
    whyUseful: `Worth keeping as a ${label} reference${topics[0] ? ` on ${topics[0]}` : ''}; reach for it when that comes up again.`,
    topics,
    entities: names,
    retrievalHints: hints.slice(0, 6),
    confidence: Math.min(0.8, 0.55 + (content.length > 500 ? 0.1 : 0) + (domain ? 0.05 : 0))
  }
  if (withImage) {
    understanding.visualDescription = 'Image attached; the offline provider does not read pixels.'
  }
  return understanding
}

interface CandidateLike {
  id: string
  cosine?: number
  flags?: string[]
  sharedEntities?: string[]
  sharedTopics?: string[]
  forItemId?: string
  title?: string
}

interface CollectionLike {
  id: string
  name: string
  cosine?: number
}

/** Deterministic organize plan: link strong candidates, join a very close collection, never create. */
export function mockOrganizePlan(userText: string): OrganizePlan {
  type ItemLike = { id: string; title?: string; topics?: string[]; domain?: string | null }
  const item = jsonField<ItemLike>(userText, 'New item')
  const items = jsonField<ItemLike[]>(userText, 'Items') ?? (item ? [item] : [])
  const candidates = jsonField<CandidateLike[]>(userText, 'Candidates') ?? []
  const collections = jsonField<CollectionLike[]>(userText, 'Existing collections') ?? []

  const relationships: RelationshipProposal[] = []
  for (const candidate of candidates) {
    const source = candidate.forItemId ?? items[0]?.id
    if (!source || candidate.id === source) continue
    const cosine = candidate.cosine ?? 0
    const shared = (candidate.sharedEntities?.length ?? 0) > 0
    const flagged = (candidate.flags ?? []).some(
      (f) => f === 'same_domain' || f === 'same_owner' || f === 'same_folder'
    )
    if (cosine < 0.6 && !flagged) continue
    relationships.push({
      sourceId: source,
      targetId: candidate.id,
      type: shared && cosine >= 0.7 ? 'same_project' : 'related_to',
      description: shared
        ? `Both mention ${candidate.sharedEntities?.[0]}.`
        : `Both are about ${candidate.sharedTopics?.[0] ?? 'the same subject'}.`,
      confidence: Math.min(0.9, Math.max(0.6, Number(cosine.toFixed(2)) || 0.6))
    })
    if (relationships.length === 3) break
  }
  if (items.length >= 2) {
    const [a, b] = items
    if (a && b) {
      const sharedTopic = (a.topics ?? []).find((t) => (b.topics ?? []).includes(t))
      if (sharedTopic || (a.domain && a.domain === b.domain)) {
        relationships.push({
          sourceId: a.id,
          targetId: b.id,
          type: 'related_to',
          description: sharedTopic ? `Kept together and both about ${sharedTopic}.` : `Kept together from ${a.domain}.`,
          confidence: 0.65
        })
      }
    }
  }

  const addToCollections: OrganizePlan['addToCollections'] = []
  for (const collection of collections) {
    if ((collection.cosine ?? 0) < 0.75) continue
    for (const target of items.slice(0, 3)) {
      addToCollections.push({
        collectionId: collection.id,
        itemId: target.id,
        confidence: Math.min(0.85, collection.cosine ?? 0.75),
        reason: `Fits "${collection.name}" closely.`
      })
    }
  }

  const n = relationships.length
  return {
    relationships,
    addToCollections,
    newCollections: [],
    understandingPatches: [],
    summary:
      n === 0
        ? 'Kept on its own for now; nothing else in the library is about this yet.'
        : n === 1
          ? 'Found 1 related thing.'
          : `Found ${n} related things.`,
    confidence: n === 0 ? 0.6 : 0.7
  }
}

/** Deterministic consolidate plan: nothing to do. */
export function mockConsolidatePlan(): ConsolidatePlan {
  return {
    renames: [],
    merges: [],
    addToCollections: [],
    newCollections: [],
    relationships: [],
    summary: 'Nothing to tidy up.',
    confidence: 0.7
  }
}

export function mockFolderUnderstanding(userText: string): FolderUnderstanding {
  const understanding = mockUnderstanding(
    userText.replace(/^Folder: /m, 'Title: ').replace(/^Path: .*$/m, 'Type: folder'),
    false
  )
  understanding.kind = 'other'
  const samples = [...userText.matchAll(/^--- (.+)$/gm)].map((m) => m[1] ?? '').filter(Boolean)
  const keyFiles = samples
    .filter((p) => /readme|index|main|brief|spec|notes?\.md$/i.test(p))
    .concat(samples)
    .filter((p, i, arr) => arr.indexOf(p) === i)
    .slice(0, 5)
    .map((path) => ({ path, why: /readme/i.test(path) ? 'Explains the folder.' : 'Sampled file with content.' }))
  return {
    understanding,
    purpose: `A folder named "${understanding.title}"${samples.length > 0 ? ` with ${samples.length} sampled text files` : ''}.`,
    keyFiles,
    collection: null
  }
}

function idsFromToolMessages(messages: ChatMessage[], max: number): { id: string; title: string }[] {
  const out: { id: string; title: string }[] = []
  for (const message of messages) {
    if (message.role !== 'tool') continue
    for (const match of message.content.matchAll(/"id"\s*:\s*"([^"]+)"(?:[^{}]*?"title"\s*:\s*"([^"]*)")?/g)) {
      const id = match[1] ?? ''
      if (!id || out.some((e) => e.id === id)) continue
      out.push({ id, title: match[2] ?? id })
      if (out.length === max) return out
    }
  }
  return out
}

/** Deterministic command finish from the transcript. */
export function mockCommandFinish(messages: ChatMessage[]): CommandFinish {
  const userText = lastUserText(messages)
  const firstUser = messages.find((m) => m.role === 'user')
  const request = firstUser ? stripContract(messageText(firstUser)) : userText
  const wantsNote = /kind "note"/i.test(request)
  const question = field(request, 'Question') ?? request.split('\n')[0] ?? ''
  const cues = keywords(question, 4)
  const seeds = jsonField<{ id: string; title: string }[]>(request, 'Selected items') ?? []
  const seed = jsonField<{ id: string; title: string }>(request, 'Item')
  const found = idsFromToolMessages(messages, 3)
  const sources = [...seeds, ...(seed ? [seed] : []), ...found]
    .filter((e, i, arr) => arr.findIndex((x) => x.id === e.id) === i)
    .slice(0, 4)
  const body =
    sources.length === 0
      ? "Couldn't find anything about that."
      : `Based on ${sources.length === 1 ? 'one item' : `${sources.length} items`}: ${sources.map((s, i) => `${s.title} [${i + 1}]`).join(', ')}.`
  const finish: CommandFinish = {
    kind: wantsNote && sources.length > 0 ? 'note' : 'answer',
    sources: sources.map((s, i) => ({
      itemId: s.id,
      role: i === 0 ? 'primary' : 'supporting',
      why: `Matched ${cues[0] ?? 'the request'}.`
    })),
    cues: { topics: cues, types: [] },
    confidence: sources.length === 0 ? 0.2 : 0.6
  }
  if (finish.kind === 'note') {
    finish.noteTitle = `Notes: ${question.slice(0, 60) || 'selected items'}`
    finish.noteMarkdown = `# ${finish.noteTitle}\n\n${body}`
  } else {
    finish.answer = body
  }
  return finish
}

/** Which structured payload a prompt asks for (`JSON schema "Name"` marker or task name). */
export function inferSchemaName(req: ChatRequest): string | null {
  const last = messageText(req.messages[lastUserIndex(req.messages)] ?? { role: 'user', content: '' })
  const marker = /JSON schema "([A-Za-z]+)"/.exec(last)
  if (marker?.[1]) return marker[1]
  switch (req.task) {
    case 'understand':
      return 'Understanding'
    case 'organize':
    case 'organize_batch':
      return 'OrganizePlan'
    case 'consolidate':
      return 'ConsolidatePlan'
    case 'folder':
      return 'FolderUnderstanding'
    case 'command':
      return 'CommandFinish'
    default:
      return null
  }
}

function structuredPayload(req: ChatRequest, name: string | null): unknown {
  const userText = lastUserText(req.messages)
  switch (name) {
    case 'Understanding':
      return mockUnderstanding(userText, hasImages(req.messages))
    case 'OrganizePlan':
      return mockOrganizePlan(userText)
    case 'ConsolidatePlan':
      return mockConsolidatePlan()
    case 'FolderUnderstanding':
      return mockFolderUnderstanding(userText)
    case 'CommandFinish':
      return mockCommandFinish(req.messages)
    default:
      return null
  }
}

export function createMockProvider(opts: MockProviderOptions = {}): AIProvider {
  const latencyMs = opts.latencyMs ?? 0
  let counter = 0

  function usage(req: ChatRequest, output: string): Usage {
    const promptTokens = estimateTokens(req.messages)
    const completionTokens = estimateTokens(output)
    return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens, latencyMs }
  }

  function respond(req: ChatRequest, content: string | null, toolCalls?: ToolCall[]): ChatResponse {
    counter++
    const message =
      toolCalls && toolCalls.length > 0
        ? { role: 'assistant' as const, content, tool_calls: toolCalls }
        : { role: 'assistant' as const, content }
    const output = (content ?? '') + (toolCalls ?? []).map((c) => c.function.arguments).join('')
    return {
      id: `mock_${counter}`,
      model: MODEL,
      message,
      finishReason: toolCalls && toolCalls.length > 0 ? 'tool_calls' : 'stop',
      usage: usage(req, output)
    }
  }

  async function chat(req: ChatRequest): Promise<ChatResponse> {
    opts.logger?.debug('ai.mock.chat', { task: req.task, tools: req.tools?.map((t) => t.function.name) })
    const tools = req.toolChoice === 'none' ? [] : (req.tools ?? [])
    if (tools.length > 0) {
      const finish = tools.find((t) => t.function.name === 'finish')
      const search =
        tools.find((t) => t.function.name === 'search_library') ??
        tools.find((t) => t.function.name === 'semantic_search')
      const hasToolResults = req.messages.some((m) => m.role === 'tool')
      const forced = req.toolChoice === 'required' && tools.length === 1
      if (search && !hasToolResults && !forced) {
        const question = messageText(req.messages.find((m) => m.role === 'user') ?? { role: 'user', content: '' })
        const query = keywords(field(question, 'Question') ?? question, 4).join(' ') || 'recent'
        const args = search.function.name === 'semantic_search' ? { query, k: 8 } : { query, filters: {} }
        return respond(req, null, [
          {
            id: `call_${counter + 1}`,
            type: 'function',
            function: { name: search.function.name, arguments: JSON.stringify(args) }
          }
        ])
      }
      if (finish) {
        const payload =
          structuredPayload(req, inferSchemaName(req) ?? 'CommandFinish') ?? mockCommandFinish(req.messages)
        return respond(req, null, [
          {
            id: `call_${counter + 1}`,
            type: 'function',
            function: { name: 'finish', arguments: JSON.stringify(payload) }
          }
        ])
      }
      const first = tools[0]
      if (first) {
        return respond(req, null, [
          { id: `call_${counter + 1}`, type: 'function', function: { name: first.function.name, arguments: '{}' } }
        ])
      }
    }
    const payload = structuredPayload(req, inferSchemaName(req))
    if (payload !== null) return respond(req, JSON.stringify(payload))
    const last = lastUserText(req.messages)
    return respond(req, `Noted: ${last.split('\n')[0]?.slice(0, 120) ?? ''}`.trim())
  }

  return withStructured({ id: 'mock', model: MODEL, chat })
}
