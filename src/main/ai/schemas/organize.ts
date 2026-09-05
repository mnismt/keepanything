/** The agent validates every entry again through the tool handlers (evidence preconditions, suppressions, collection quality rules); this schema only guarantees shape. */
import { z } from 'zod'
import { RELATIONSHIP_TYPE_IDS } from '../../../shared/kinds'
import type { RelationshipType } from '../../../shared/types'
import { confidenceSchema, defineSchema, lenientEnum, nonEmptyString, stringList } from './common'

const RELATIONSHIP_IDS = [...RELATIONSHIP_TYPE_IDS] as [RelationshipType, ...RelationshipType[]]

export const relationshipProposalZod = z.object({
  sourceId: nonEmptyString,
  targetId: nonEmptyString,
  type: lenientEnum(RELATIONSHIP_IDS),
  /** One sentence, product voice: why these belong together. */
  description: nonEmptyString,
  confidence: confidenceSchema,
  /** Optional quote from the target's text that supports the link. */
  evidenceQuote: z.string().optional()
})

export const collectionAdditionZod = z.object({
  collectionId: nonEmptyString,
  itemId: nonEmptyString,
  confidence: confidenceSchema,
  reason: nonEmptyString
})

export const collectionProposalZod = z.object({
  /** ≥ 2 words, a meaningful ongoing context, never a single topic word. */
  name: nonEmptyString,
  /** ≥ 60 chars: what belongs here and what does not. */
  description: nonEmptyString,
  members: z.array(z.object({ itemId: nonEmptyString, reason: nonEmptyString })).min(1),
  confidence: confidenceSchema
})

/** Partial understanding fix the organize step noticed (rare). */
export const understandingPatchZod = z.object({
  itemId: nonEmptyString,
  topics: stringList(6).optional(),
  entities: stringList(12).optional(),
  retrievalHints: stringList(6).optional(),
  reason: nonEmptyString
})

export const organizePlanZod = z.object({
  relationships: z.array(relationshipProposalZod).default([]),
  addToCollections: z.array(collectionAdditionZod).default([]),
  newCollections: z.array(collectionProposalZod).default([]),
  understandingPatches: z.array(understandingPatchZod).default([]),
  /** One or two sentences in product voice ("This looks like part of your MiniMax research."). */
  summary: nonEmptyString,
  confidence: confidenceSchema
})

export type RelationshipProposal = z.output<typeof relationshipProposalZod>
export type CollectionAddition = z.output<typeof collectionAdditionZod>
export type CollectionProposal = z.output<typeof collectionProposalZod>
export type UnderstandingPatch = z.output<typeof understandingPatchZod>
export type OrganizePlan = z.output<typeof organizePlanZod>

export const organizePlanSchema = defineSchema<OrganizePlan>('OrganizePlan', organizePlanZod, {
  description: 'Conservative plan: relationships, collection memberships and (rarely) new collections.'
})
