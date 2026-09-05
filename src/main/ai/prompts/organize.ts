import type { ChatMessage, ChatRequest } from '../../ports'
import { systemMessage, userMessage } from '../messages'
import { COLLECTION_RULES, IDENTITY, jsonBlock, RELATIONSHIP_CATALOG, RELATIONSHIP_RULES, VOICE_RULES } from './voice'

export interface OrganizeItemContext {
  id: string
  title: string
  type: string
  subtype?: string | null
  kind?: string | null
  domain?: string | null
  capturedAgo?: string
  topics?: string[]
  entities?: string[]
  understanding?: string | null
  whyUseful?: string | null
}

export interface OrganizeCandidate {
  id: string
  title: string
  type: string
  kind?: string | null
  domain?: string | null
  capturedAgo?: string
  topics?: string[]
  /** ≤ 140 chars. */
  understanding?: string | null
  cosine?: number
  sharedTopics?: string[]
  sharedEntities?: string[]
  /** Deterministic signals: `same_domain`, `same_owner`, `same_folder`, `same_hour`, `user_related`. */
  flags?: string[]
  /** For batch runs: which new item this candidate was retrieved for. */
  forItemId?: string
}

export interface CollectionContext {
  id: string
  name: string
  description?: string | null
  count: number
  createdBy: 'user' | 'agent'
  cosine?: number
  nearestMembers?: { id: string; title: string }[]
}

export interface OrganizeInput {
  item: OrganizeItemContext
  candidates: OrganizeCandidate[]
  collections: CollectionContext[]
  /** Facts the user established (memberships, relationships) rendered as sentences. Ground truth. */
  userFacts?: string[]
  /** Facts the user removed; never propose them again. */
  suppressed?: string[]
}

export interface OrganizeBatchInput {
  items: OrganizeItemContext[]
  candidates: OrganizeCandidate[]
  collections: CollectionContext[]
  userFacts?: string[]
  suppressed?: string[]
}

/** Byte-stable system prompt shared by organize and organize_batch. */
export const ORGANIZE_SYSTEM_PROMPT = [
  IDENTITY,
  '',
  'Task: relate newly kept items to the library and decide, conservatively, whether they belong in a collection.',
  'You receive thin candidates (retrieved by similarity and shared topics) and the existing collections. Candidates are hints, not facts: a high cosine with nothing concrete in common is not a relationship.',
  'When tools are available, inspect an item before proposing a typed relationship with it, and list collections before creating one.',
  '',
  VOICE_RULES,
  '',
  'Relationship types:',
  RELATIONSHIP_CATALOG,
  '',
  RELATIONSHIP_RULES,
  '',
  COLLECTION_RULES,
  '',
  'Summary: one or two sentences to the person, e.g. "This looks like part of your MiniMax research." or "Kept on its own for now; nothing else in the library is about this yet."',
  'It is fine, and common, to return no relationships and no collections.'
].join('\n')

function contextLines(input: {
  collections: CollectionContext[]
  userFacts?: string[]
  suppressed?: string[]
}): string[] {
  const lines: string[] = []
  lines.push(jsonBlock('Existing collections', input.collections))
  if (input.userFacts && input.userFacts.length > 0)
    lines.push('', 'Facts the person established (ground truth):', ...input.userFacts.map((f) => `- ${f}`))
  if (input.suppressed && input.suppressed.length > 0)
    lines.push('', 'Removed by the person (never propose again):', ...input.suppressed.map((f) => `- ${f}`))
  return lines
}

export function buildOrganizeMessages(input: OrganizeInput): ChatMessage[] {
  const body = [
    jsonBlock('New item', input.item),
    '',
    jsonBlock('Candidates', input.candidates),
    '',
    ...contextLines(input),
    '',
    'Decide which candidates truly relate to the new item, whether it belongs in an existing collection, and only if the rules are met, whether a new collection is justified.'
  ].join('\n')
  return [systemMessage(ORGANIZE_SYSTEM_PROMPT), userMessage(body)]
}

export function buildOrganizeBatchMessages(input: OrganizeBatchInput): ChatMessage[] {
  const body = [
    `New items kept together (${input.items.length}):`,
    jsonBlock('Items', input.items),
    '',
    jsonBlock('Candidates', input.candidates),
    '',
    ...contextLines(input),
    '',
    'Items dropped together often share a purpose; check whether they do before linking them (same_project when they are pieces of one effort, related_to when they merely share a subject). Then relate each to the existing library and decide about collections.'
  ].join('\n')
  return [systemMessage(ORGANIZE_SYSTEM_PROMPT), userMessage(body)]
}

export function buildOrganizeRequest(input: OrganizeInput, signal?: AbortSignal): ChatRequest {
  return { messages: buildOrganizeMessages(input), task: 'organize', signal }
}

export function buildOrganizeBatchRequest(input: OrganizeBatchInput, signal?: AbortSignal): ChatRequest {
  return { messages: buildOrganizeBatchMessages(input), task: 'organize_batch', signal }
}
