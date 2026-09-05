import { z } from 'zod'
import { confidenceSchema, defineSchema, nonEmptyString } from './common'
import { collectionAdditionZod, collectionProposalZod, relationshipProposalZod } from './organize'

/** Rename (and re-describe) an agent-created collection. */
export const collectionRenameZod = z.object({
  collectionId: nonEmptyString,
  name: nonEmptyString,
  description: nonEmptyString,
  reason: nonEmptyString
})

/** Fold `fromCollectionId` into `intoCollectionId` (members move, the empty one is removed). */
export const collectionMergeZod = z.object({
  fromCollectionId: nonEmptyString,
  intoCollectionId: nonEmptyString,
  reason: nonEmptyString
})

export const consolidatePlanZod = z.object({
  renames: z.array(collectionRenameZod).default([]),
  merges: z.array(collectionMergeZod).default([]),
  addToCollections: z.array(collectionAdditionZod).default([]),
  newCollections: z.array(collectionProposalZod).default([]),
  relationships: z.array(relationshipProposalZod).default([]),
  summary: nonEmptyString,
  confidence: confidenceSchema
})

export type CollectionRename = z.output<typeof collectionRenameZod>
export type CollectionMerge = z.output<typeof collectionMergeZod>
export type ConsolidatePlan = z.output<typeof consolidatePlanZod>

export const consolidatePlanSchema = defineSchema<ConsolidatePlan>('ConsolidatePlan', consolidatePlanZod, {
  description: 'Library-wide tidy-up of agent-created collections. Prefer doing nothing over doing something vague.'
})
