import { z } from 'zod'
import { ITEM_ACTIONS } from '../../../shared/actions'
import { KINDS } from '../../../shared/kinds'
import type { Understanding } from '../../../shared/types'
import { confidenceSchema, defineSchema, lenientEnum, lenientEnumList, nonEmptyString, stringList } from './common'

const ACTION_IDS = ITEM_ACTIONS.map((a) => a.id) as [string, ...string[]]

const optionalText = z.preprocess(
  (v) => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined),
  z.string().optional()
)

/** Zod schema for `Understanding`. Field order matches the prompt contract. */
export const understandingZod = z.object({
  kind: lenientEnum(KINDS),
  title: nonEmptyString.pipe(z.string().max(160)),
  summary: nonEmptyString,
  whyUseful: nonEmptyString,
  topics: stringList(6),
  entities: stringList(12),
  visualDescription: optionalText,
  visibleText: optionalText,
  retrievalHints: stringList(6),
  suggestedActions: lenientEnumList(ACTION_IDS, 4),
  confidence: confidenceSchema
}) as unknown as z.ZodType<Understanding, unknown>

export const understandingSchema = defineSchema<Understanding>('Understanding', understandingZod, {
  description: 'What a kept item is, what it contains and why someone would keep it.'
})
