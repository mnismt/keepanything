import { z } from 'zod'
import type { Understanding } from '../../../shared/types'
import { confidenceSchema, defineSchema, nonEmptyString } from './common'
import { understandingZod } from './understanding'

export const keyFileZod = z.object({
  path: nonEmptyString,
  why: nonEmptyString
})

export const folderCollectionZod = z.object({
  name: nonEmptyString,
  description: nonEmptyString,
  confidence: confidenceSchema
})

export const folderUnderstandingZod = z.object({
  understanding: understandingZod,
  /** What the folder seems to be for, one or two sentences. */
  purpose: nonEmptyString,
  keyFiles: z.array(keyFileZod).max(10).default([]),
  /** Present only when the children form a meaningful ongoing context. */
  collection: folderCollectionZod.nullable().default(null)
})

export interface FolderUnderstanding {
  understanding: Understanding
  purpose: string
  keyFiles: z.output<typeof keyFileZod>[]
  collection: z.output<typeof folderCollectionZod> | null
}

export const folderUnderstandingSchema = defineSchema<FolderUnderstanding>(
  'FolderUnderstanding',
  folderUnderstandingZod as unknown as z.ZodType<FolderUnderstanding, unknown>,
  { description: 'What a folder is, which files matter and whether it deserves a collection.' }
)
