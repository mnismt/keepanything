import type { ChatMessage, ChatRequest } from '../../ports'
import { systemMessage, userMessage } from '../messages'
import { COLLECTION_RULES, IDENTITY, jsonBlock, RELATIONSHIP_RULES, VOICE_RULES } from './voice'

export interface ConsolidateCollection {
  id: string
  name: string
  description?: string | null
  count: number
  createdBy: 'user' | 'agent'
  members: { id: string; title: string; kind?: string | null }[]
}

export interface ConsolidateItem {
  id: string
  title: string
  kind?: string | null
  topics?: string[]
  understanding?: string | null
  collectionIds?: string[]
  capturedAgo?: string
}

export interface ConsolidateInput {
  collections: ConsolidateCollection[]
  /** Items organized since the last sweep plus their neighbours (pre-clustered above 200 items). */
  items: ConsolidateItem[]
  suppressed?: string[]
}

/** Byte-stable system prompt. */
export const CONSOLIDATE_SYSTEM_PROMPT = [
  IDENTITY,
  '',
  'Task: look at the library after a batch of items was organized one by one and tidy up: rename agent-created collections whose names no longer fit their members, merge two agent-created collections that are the same context, add items that clearly belong to an existing collection, and create a collection only when several unorganized items form an obvious ongoing context.',
  '',
  VOICE_RULES,
  '',
  COLLECTION_RULES,
  '',
  RELATIONSHIP_RULES,
  '',
  'Renames need a reason a person would agree with after reading the members. Merges only when both collections were created by the agent and mean the same thing.',
  'Never touch collections created by the person (createdBy: user) except to add clearly fitting items.',
  'Summary: one or two sentences to the person about what changed, or "Nothing to tidy up." when the plan is empty.'
].join('\n')

export function buildConsolidateMessages(input: ConsolidateInput): ChatMessage[] {
  const body = [
    jsonBlock('Collections', input.collections),
    '',
    jsonBlock('Items', input.items),
    ...(input.suppressed && input.suppressed.length > 0
      ? ['', 'Removed by the person (never propose again):', ...input.suppressed.map((f) => `- ${f}`)]
      : []),
    '',
    'Propose the smallest set of changes that makes the collections more truthful. An empty plan is a valid answer.'
  ].join('\n')
  return [systemMessage(CONSOLIDATE_SYSTEM_PROMPT), userMessage(body)]
}

export function buildConsolidateRequest(input: ConsolidateInput, signal?: AbortSignal): ChatRequest {
  return { messages: buildConsolidateMessages(input), task: 'consolidate', signal }
}
