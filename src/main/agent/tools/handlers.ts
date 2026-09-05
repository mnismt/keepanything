import type { z } from 'zod'
import { LIMITS } from '../../../shared/constants'
import { truncate } from '../../../shared/text'
import type { AgentStep, Item, ItemType, SearchFilters } from '../../../shared/types'
import { formatZodError, repairToolArguments } from '../../ai'
import type { Clock } from '../../ports'
import type { RetrievalService } from '../../retrieval'
import { readableText } from '../../retrieval'
import type { Repositories } from '../../storage/repositories'
import {
  inspectArgs,
  listCollectionsArgs,
  listItemsArgs,
  type ProposedAction,
  proposeArgs,
  readArgs,
  searchArgs,
  semanticArgs,
  topicOverviewArgs
} from './definitions'

/** Largest tool result fed back to the model (chars). */
export const MAX_TOOL_RESULT_CHARS = 9_000

export interface ToolEnv {
  retrieval: RetrievalService
  repos: Repositories
  clock: Clock
  /** Full text of an item (file on disk or extracted text); null when nothing is readable. */
  readContent(item: Item): Promise<string | null>
}

export interface RunMemory {
  /** Ids returned by searches / lists. */
  seen: Set<string>
  /** Ids inspected or read (eligible sources). */
  inspected: Set<string>
  /** Staged proposals, validated shape only. */
  proposals: ProposedAction[]
  /** Queries used (for the cues header). */
  queries: string[]
}

export function createRunMemory(): RunMemory {
  return { seen: new Set(), inspected: new Set(), proposals: [], queries: [] }
}

/** A step before numbering. */
export type StepDraft = Omit<AgentStep, 'n' | 'durationMs'>

export interface ToolResult {
  content: string
  step: StepDraft
}

function cap(value: unknown): string {
  const text = JSON.stringify(value)
  return text.length > MAX_TOOL_RESULT_CHARS ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}…(truncated)` : text
}

function rejected(tool: string, kind: AgentStep['kind'], label: string, reason: string, hint?: string): ToolResult {
  return {
    content: JSON.stringify({ error: reason, ...(hint ? { hint } : {}) }),
    step: { tool, kind, label, status: 'rejected', rejectReason: reason }
  }
}

function parse<T>(schema: z.ZodType<T, unknown>, raw: string): { value: T } | { error: string } {
  const repaired = repairToolArguments(raw)
  if ('error' in repaired) return { error: repaired.error }
  try {
    return { value: schema.parse(repaired.value) }
  } catch (error) {
    return { error: formatZodError(error) }
  }
}

function filtersFrom(input: z.output<typeof searchArgs>['filters']): SearchFilters {
  const filters: SearchFilters = {}
  if (!input) return filters
  if (input.types && input.types.length > 0) filters.types = input.types as ItemType[]
  if (input.kinds && input.kinds.length > 0) filters.kinds = input.kinds as SearchFilters['kinds']
  if (input.domains && input.domains.length > 0) filters.domains = input.domains
  if (input.since) filters.since = input.since
  if (input.until) filters.until = input.until
  return filters
}

/** Dispatch one tool call. Never throws for model mistakes. */
export async function dispatchTool(
  name: string,
  rawArgs: string,
  env: ToolEnv,
  memory: RunMemory
): Promise<ToolResult> {
  switch (name) {
    case 'search_library': {
      const parsed = parse(searchArgs, rawArgs)
      if ('error' in parsed) return rejected(name, 'search', 'Searching your library', parsed.error)
      const { query, filters, k } = parsed.value
      memory.queries.push(query)
      const hits = await env.retrieval.search(query, filtersFrom(filters), k ?? 10)
      for (const h of hits) memory.seen.add(h.id)
      return {
        content: cap(
          hits.map((h) => ({
            id: h.id,
            title: h.title,
            type: h.type,
            kind: h.kind,
            domain: h.domain,
            capturedAgo: h.capturedAgo,
            understanding: h.understanding,
            snippet: h.snippet,
            why: (h as { reason?: string }).reason
          }))
        ),
        step: {
          tool: name,
          kind: 'search',
          label: `Searching your library for “${truncate(query, 60)}”`,
          itemIds: hits.map((h) => h.id),
          status: 'ok'
        }
      }
    }
    case 'semantic_search': {
      const parsed = parse(semanticArgs, rawArgs)
      if ('error' in parsed) return rejected(name, 'search', 'Looking for similar things', parsed.error)
      const { query, k } = parsed.value
      memory.queries.push(query)
      const hits = await env.retrieval.semantic(query, k ?? 10)
      for (const h of hits) memory.seen.add(h.id)
      return {
        content: cap(
          hits.map((h) => ({
            id: h.id,
            title: h.title,
            type: h.type,
            kind: h.kind,
            capturedAgo: h.capturedAgo,
            understanding: h.understanding,
            cosine: h.evidence.cosine
          }))
        ),
        step: {
          tool: name,
          kind: 'search',
          label: `Looking for things like “${truncate(query, 60)}”`,
          itemIds: hits.map((h) => h.id),
          status: 'ok'
        }
      }
    }
    case 'inspect_item': {
      const parsed = parse(inspectArgs, rawArgs)
      if ('error' in parsed) return rejected(name, 'inspect', 'Looking at items', parsed.error)
      const cards = env.retrieval.contextFor(parsed.value.ids, 6_000)
      const missing = parsed.value.ids.filter((id) => !cards.some((c) => c.id === id))
      if (cards.length === 0)
        return rejected(
          name,
          'inspect',
          'Looking at items',
          'No such items.',
          'Use ids returned by search_library or list_items.'
        )
      for (const c of cards) memory.inspected.add(c.id)
      const label =
        cards.length === 1 ? `Looking at “${truncate(cards[0]?.title ?? '', 60)}”` : `Looking at ${cards.length} items`
      return {
        content: cap({ items: cards, ...(missing.length > 0 ? { notFound: missing } : {}) }),
        step: { tool: name, kind: 'inspect', label, itemIds: cards.map((c) => c.id), status: 'ok' }
      }
    }
    case 'read_document': {
      const parsed = parse(readArgs, rawArgs)
      if ('error' in parsed) return rejected(name, 'read', 'Reading an item', parsed.error)
      const item = env.repos.items.get(parsed.value.id)
      if (!item || item.deletedAt)
        return rejected(name, 'read', 'Reading an item', 'No such item.', 'Use ids returned by search_library.')
      const text = (await env.readContent(item)) ?? readableText(item)
      const offset = parsed.value.offset ?? 0
      const max = parsed.value.maxChars ?? LIMITS.readDocumentChars
      const slice = text.slice(offset, offset + max)
      memory.inspected.add(item.id)
      return {
        content: cap({
          id: item.id,
          title: item.title,
          offset,
          totalChars: text.length,
          hasMore: offset + max < text.length,
          text: slice.length > 0 ? slice : '(no readable text; rely on the card from inspect_item)'
        }),
        step: {
          tool: name,
          kind: 'read',
          label: `Reading “${truncate(item.title, 60)}”`,
          itemIds: [item.id],
          status: 'ok'
        }
      }
    }
    case 'list_items': {
      const parsed = parse(listItemsArgs, rawArgs)
      if ('error' in parsed) return rejected(name, 'search', 'Scanning recent items', parsed.error)
      const limit = parsed.value.limit ?? 30
      const types = parsed.value.types as ItemType[] | undefined
      let items = env.repos.items.list({ view: 'library', limit: limit * 2, ...(types ? { types } : {}) })
      const since = parsed.value.since ? Date.parse(parsed.value.since) : Number.NaN
      if (Number.isFinite(since)) items = items.filter((i) => Date.parse(i.capturedAt) >= since)
      items = items.slice(0, limit)
      for (const i of items) memory.seen.add(i.id)
      const cards = env.retrieval.contextFor(
        items.map((i) => i.id),
        7_000
      )
      return {
        content: cap(
          cards.map((c) => ({
            id: c.id,
            title: c.title,
            type: c.type,
            kind: c.kind,
            capturedAgo: c.capturedAgo,
            understanding: c.understanding ? truncate(c.understanding, 140) : null,
            topics: c.topics
          }))
        ),
        step: {
          tool: name,
          kind: 'search',
          label: `Scanning ${cards.length} recent items`,
          itemIds: cards.map((c) => c.id),
          status: 'ok'
        }
      }
    }
    case 'topic_overview': {
      const parsed = parse(topicOverviewArgs, rawArgs)
      if ('error' in parsed) return rejected(name, 'search', 'Getting an overview of your library', parsed.error)
      const limit = parsed.value.limit ?? 15
      let items = env.repos.items.list({ view: 'library', limit: 500 })
      const since = parsed.value.since ? Date.parse(parsed.value.since) : Number.NaN
      if (Number.isFinite(since)) items = items.filter((i) => Date.parse(i.capturedAt) >= since)
      const topics = new Map<string, { count: number; examples: { id: string; title: string }[] }>()
      const kinds = new Map<string, number>()
      for (const item of items) {
        if (item.kind) kinds.set(item.kind, (kinds.get(item.kind) ?? 0) + 1)
        for (const raw of item.topics) {
          const key = raw.toLowerCase()
          const entry = topics.get(key) ?? { count: 0, examples: [] }
          entry.count += 1
          if (entry.examples.length < 3) entry.examples.push({ id: item.id, title: truncate(item.title, 60) })
          topics.set(key, entry)
        }
      }
      const top = [...topics.entries()]
        .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
        .slice(0, limit)
        .map(([topic, entry]) => ({ topic, count: entry.count, examples: entry.examples }))
      for (const t of top) for (const e of t.examples) memory.seen.add(e.id)
      return {
        content: cap({
          items: items.length,
          kinds: Object.fromEntries([...kinds.entries()].sort((a, b) => b[1] - a[1])),
          topics: top
        }),
        step: { tool: name, kind: 'search', label: 'Getting an overview of your library', status: 'ok' }
      }
    }
    case 'list_collections': {
      const parsed = parse(listCollectionsArgs, rawArgs)
      if ('error' in parsed) return rejected(name, 'inspect', 'Checking your collections', parsed.error)
      const collections = env.repos.collections.listSummaries().map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        count: c.count,
        createdBy: c.createdBy
      }))
      return {
        content: cap(collections),
        step: { tool: name, kind: 'inspect', label: 'Checking your collections', status: 'ok' }
      }
    }
    case 'propose_actions': {
      const parsed = parse(proposeArgs, rawArgs)
      if ('error' in parsed) return rejected(name, 'write', 'Proposing changes', parsed.error)
      const accepted: ProposedAction[] = []
      const problems: string[] = []
      for (const action of parsed.value.actions) {
        const ids =
          action.kind === 'create_collection'
            ? action.itemIds
            : action.kind === 'relate'
              ? [action.sourceId, action.targetId]
              : [action.itemId]
        const unknown = ids.filter((id) => !env.repos.items.get(id))
        if (unknown.length > 0) {
          problems.push(`${action.kind}: unknown item ${unknown.join(', ')}`)
          continue
        }
        if (action.kind === 'add_to_collection' && !env.repos.collections.get(action.collectionId)) {
          problems.push(`add_to_collection: unknown collection ${action.collectionId}`)
          continue
        }
        accepted.push(action)
      }
      memory.proposals.push(...accepted)
      return {
        content: JSON.stringify({
          staged: accepted.length,
          note: 'Proposals are shown to the person for approval; they are not applied yet.',
          ...(problems.length > 0 ? { rejected: problems } : {})
        }),
        step: {
          tool: name,
          kind: 'write',
          label: accepted.length === 1 ? 'Proposing 1 change' : `Proposing ${accepted.length} changes`,
          status: accepted.length > 0 ? 'ok' : 'rejected',
          ...(accepted.length === 0 ? { rejectReason: problems.join('; ') || 'nothing to propose' } : {})
        }
      }
    }
    default:
      return rejected(
        name,
        'inspect',
        'Trying something unavailable',
        `Unknown tool "${name}".`,
        'Available: search_library, semantic_search, inspect_item, read_document, list_items, topic_overview, list_collections, propose_actions, finish.'
      )
  }
}
