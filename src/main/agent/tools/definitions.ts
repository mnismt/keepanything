/** Specs are module constants so every call of a run shares a byte-identical tools prefix (server-side cache). */

import { z } from 'zod'
import { LIMITS } from '../../../shared/constants'
import { RELATIONSHIP_TYPE_IDS } from '../../../shared/kinds'
import type { RelationshipType } from '../../../shared/types'
import { commandFinishSchema, finishToolSpec, lenientEnum } from '../../ai'

const nonEmptyString = z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1))

import type { JsonObject, ToolSpec } from '../../ports'

const ITEM_TYPES = [
  'file',
  'folder',
  'image',
  'video',
  'audio',
  'pdf',
  'text',
  'markdown',
  'url',
  'note',
  'unknown'
] as const

const idList = z.preprocess((v) => (typeof v === 'string' ? [v] : v), z.array(z.string().min(1)).min(1).max(8))

export const searchArgs = z.object({
  query: nonEmptyString,
  filters: z
    .object({
      types: z.array(lenientEnum(ITEM_TYPES)).optional(),
      kinds: z.array(z.string()).optional(),
      domains: z.array(z.string()).optional(),
      since: z.string().optional(),
      until: z.string().optional()
    })
    .partial()
    .optional(),
  k: z.coerce.number().int().min(1).max(20).optional()
})

export const semanticArgs = z.object({
  query: nonEmptyString,
  k: z.coerce.number().int().min(1).max(20).optional()
})

/** `inspect_item` arguments (`id` or `ids`). */
export const inspectArgs = z.preprocess(
  (v) => {
    if (typeof v === 'object' && v !== null && 'id' in v && !('ids' in v)) return { ids: [(v as { id: unknown }).id] }
    return v
  },
  z.object({ ids: idList })
)

export const readArgs = z.object({
  id: nonEmptyString,
  offset: z.coerce.number().int().min(0).optional(),
  maxChars: z.coerce.number().int().min(200).max(20_000).optional()
})

export const listItemsArgs = z.object({
  since: z.string().optional(),
  types: z.array(lenientEnum(ITEM_TYPES)).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional()
})

export const topicOverviewArgs = z.object({
  since: z.string().optional(),
  limit: z.coerce.number().int().min(3).max(40).optional()
})

export const listCollectionsArgs = z.object({}).passthrough()

const confidence = z.coerce.number().min(0).max(1).catch(0.5)
const RELATIONSHIP_IDS = [...RELATIONSHIP_TYPE_IDS] as [RelationshipType, ...RelationshipType[]]

export const proposedActionZod = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('add_to_collection'),
    collectionId: nonEmptyString,
    itemId: nonEmptyString,
    reason: nonEmptyString,
    confidence
  }),
  z.object({
    kind: z.literal('create_collection'),
    name: nonEmptyString,
    description: nonEmptyString,
    itemIds: z.array(z.string().min(1)).min(1).max(30),
    reason: nonEmptyString,
    confidence
  }),
  z.object({
    kind: z.literal('relate'),
    sourceId: nonEmptyString,
    targetId: nonEmptyString,
    type: lenientEnum(RELATIONSHIP_IDS),
    description: nonEmptyString,
    confidence
  }),
  z.object({
    kind: z.literal('tag'),
    itemId: nonEmptyString,
    topics: z.array(z.string().min(1)).min(1).max(6),
    confidence
  }),
  z.object({ kind: z.literal('rename'), itemId: nonEmptyString, title: nonEmptyString, confidence }),
  z.object({ kind: z.literal('trash'), itemId: nonEmptyString, reason: nonEmptyString, confidence })
])

export const proposeArgs = z.object({ actions: z.array(proposedActionZod).min(1).max(12) })

export type ProposedAction = z.output<typeof proposedActionZod>

function params(schema: z.ZodType): JsonObject {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as JsonObject
  delete json.$schema
  return json
}

function tool(name: string, description: string, schema: z.ZodType): ToolSpec {
  return { type: 'function', function: { name, description, parameters: params(schema) } }
}

/** Read tools, in a fixed order. */
export const AGENT_TOOLS: readonly ToolSpec[] = Object.freeze([
  tool(
    'search_library',
    'Hybrid search over the library (full text + meaning). Use memory cues as the query; optional filters narrow by type, kind, domain or capture date (ISO). Returns thin candidates with why they matched.',
    searchArgs
  ),
  tool('semantic_search', 'Search by meaning only (embeddings). Good for vague descriptions.', semanticArgs),
  tool(
    'inspect_item',
    'Full cards for up to 8 items: understanding, why it was kept, topics, entities, excerpt, facts. Inspect before citing.',
    inspectArgs
  ),
  tool(
    'read_document',
    `Read the text of one item in chunks (default ${LIMITS.readDocumentChars} characters from offset 0). Use offset to continue.`,
    readArgs
  ),
  tool(
    'list_items',
    'Recent items (newest first) with optional since (ISO date) and type filters, up to 50. For questions about the library as a whole.',
    listItemsArgs
  ),
  tool(
    'topic_overview',
    'What the library is about: the most common topics and kinds with counts and example item ids, optionally since an ISO date. Start here for "what am I researching?" questions.',
    topicOverviewArgs
  ),
  tool('list_collections', 'Every collection with its description, size and who created it.', listCollectionsArgs),
  tool(
    'propose_actions',
    'Stage changes for the person to approve: add_to_collection, create_collection, relate, tag, rename, trash. Nothing is applied by this call; include a reason and confidence for each.',
    proposeArgs
  )
])

export const FINISH_TOOL: ToolSpec = finishToolSpec(commandFinishSchema)

/** Names of the read/propose tools. */
export const TOOL_NAMES: readonly string[] = AGENT_TOOLS.map((t) => t.function.name)
