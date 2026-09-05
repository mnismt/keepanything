import { z } from 'zod'
import type { AgentCues, AgentSource, ItemType } from '../../../shared/types'
import { confidenceSchema, defineSchema, lenientEnum, lenientEnumList, nonEmptyString, stringList } from './common'

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
] as const satisfies readonly ItemType[]

export const agentSourceZod = z.object({
  itemId: nonEmptyString,
  role: lenientEnum(['primary', 'supporting']).default('supporting'),
  why: nonEmptyString
})

const isoOrUndefined = z.preprocess(
  (v) => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined),
  z.string().optional()
)

/** Memory cues the model extracted from the question. */
export const agentCuesZod = z.object({
  topics: stringList(8).default([]),
  types: lenientEnumList(ITEM_TYPES, 4).default([]),
  /** Object form preferred; MiniMax sometimes returns a bare label string ("last 3 weeks"), accepted as `{ label }`. */
  timeframe: z.preprocess(
    (v) => (typeof v === 'string' ? (v.trim() ? { label: v.trim() } : undefined) : v),
    z
      .object({ since: isoOrUndefined, until: isoOrUndefined, label: isoOrUndefined })
      .optional()
      .nullable()
      .transform((v) => (v && (v.since || v.until || v.label) ? v : undefined))
  )
})

export const commandFinishZod = z
  .object({
    kind: lenientEnum(['answer', 'note']),
    /** Markdown answer with `[n]` markers pointing at `sources`. Required for `answer`. */
    answer: z.string().optional(),
    /** For `kind: 'note'` — the note the agent should create. */
    noteTitle: z.string().optional(),
    noteMarkdown: z.string().optional(),
    sources: z.array(agentSourceZod).default([]),
    cues: agentCuesZod.default({ topics: [], types: [], timeframe: undefined }),
    confidence: confidenceSchema
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'answer' && (!value.answer || value.answer.trim().length === 0)) {
      ctx.addIssue({ code: 'custom', path: ['answer'], message: 'answer is required when kind is "answer"' })
    }
    if (value.kind === 'note' && (!value.noteMarkdown || value.noteMarkdown.trim().length === 0)) {
      ctx.addIssue({ code: 'custom', path: ['noteMarkdown'], message: 'noteMarkdown is required when kind is "note"' })
    }
  })

export interface CommandFinish {
  kind: 'answer' | 'note'
  answer?: string
  noteTitle?: string
  noteMarkdown?: string
  sources: AgentSource[]
  cues: AgentCues
  confidence: number
}

export const commandFinishSchema = defineSchema<CommandFinish>(
  'CommandFinish',
  commandFinishZod as unknown as z.ZodType<CommandFinish, unknown>,
  { description: 'Final answer or note, with the items it is based on.' }
)
