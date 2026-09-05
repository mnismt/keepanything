import { z } from 'zod'
import type { IpcChannel, IpcRequest } from '../../shared/ipc'
import { isKind, RELATIONSHIP_TYPE_IDS } from '../../shared/kinds'
import type { ItemSubtype, ItemType, Kind, RelationshipType, Stage } from '../../shared/types'

/**
 * Zod schemas for every request payload in `IpcRequestMap`. Each entry is checked against the
 * shared type with `satisfies z.ZodType<IpcRequest<C>>` so the contract cannot drift silently.
 */

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
const SUBTYPES = [
  'article',
  'github_repo',
  'youtube',
  'tweet',
  'product',
  'docs',
  'paper',
  'figma',
  'social',
  'generic',
  'screenshot',
  'photo',
  'design',
  'document',
  'spreadsheet',
  'presentation',
  'archive',
  'code',
  'data',
  'other'
] as const satisfies readonly ItemSubtype[]
const STAGES = [
  'extract',
  'thumbnail',
  'snapshot',
  'embed',
  'index',
  'understand',
  'relate',
  'organize_batch',
  'consolidate'
] as const satisfies readonly Stage[]

const id = z.string().min(1).max(128)
const ids = z.array(id).min(1).max(5000)
const text = (max: number): z.ZodString => z.string().max(max)
const optionalText = (max: number): z.ZodOptional<z.ZodString> => text(max).optional()
const itemType = z.enum(ITEM_TYPES)
const subtype = z.enum(SUBTYPES)
const stage = z.enum(STAGES)
const kind = z.custom<Kind>(isKind, 'Unknown kind')
const relationshipType = z.enum(RELATIONSHIP_TYPE_IDS as [RelationshipType, ...RelationshipType[]])
const isoDate = z.string().refine((s) => Number.isFinite(Date.parse(s)), 'Expected an ISO-8601 timestamp')
const httpUrl = z
  .string()
  .url()
  .max(4096)
  .refine((u) => /^https?:\/\//i.test(u), 'Only http(s) links')

const searchFilters = z
  .object({
    types: z.array(itemType).max(20).optional(),
    subtypes: z.array(subtype).max(40).optional(),
    kinds: z.array(kind).max(40).optional(),
    domains: z.array(text(253)).max(50).optional(),
    since: isoDate.optional(),
    until: isoDate.optional(),
    strict: z.boolean().optional()
  })
  .strict()

const dynamicQuery = z
  .object({
    text: text(500),
    filters: searchFilters,
    minCosine: z.number().min(0).max(1)
  })
  .strict()

const empty = z.undefined()
const bytes = z.custom<ArrayBuffer>((v) => v instanceof ArrayBuffer || ArrayBuffer.isView(v), 'Expected bytes')

export const REQUEST_SCHEMAS = {
  'items:list': z
    .object({
      view: z.enum(['library', 'links', 'files', 'trash', 'collection']),
      collectionId: id.optional(),
      types: z.array(itemType).max(20).optional(),
      sort: z.enum(['captured', 'created', 'title']).optional(),
      limit: z.number().int().min(1).max(5000).optional(),
      offset: z.number().int().min(0).optional()
    })
    .strict() satisfies z.ZodType<IpcRequest<'items:list'>>,
  'items:get': z.object({ id }).strict() satisfies z.ZodType<IpcRequest<'items:get'>>,
  'items:update': z
    .object({
      id,
      patch: z
        .object({ title: optionalText(300), understanding: optionalText(4000), whyUseful: optionalText(4000) })
        .strict()
    })
    .strict() satisfies z.ZodType<IpcRequest<'items:update'>>,
  'items:trash': z.object({ ids }).strict() satisfies z.ZodType<IpcRequest<'items:trash'>>,
  'items:restore': z.object({ ids }).strict() satisfies z.ZodType<IpcRequest<'items:restore'>>,
  'items:deleteForever': z.object({ ids }).strict() satisfies z.ZodType<IpcRequest<'items:deleteForever'>>,
  'items:reprocess': z.object({ id, from: stage.optional() }).strict() satisfies z.ZodType<
    IpcRequest<'items:reprocess'>
  >,
  'items:reprocessAll': z.object({ from: stage.optional() }).strict() satisfies z.ZodType<
    IpcRequest<'items:reprocessAll'>
  >,
  'items:openOriginal': z.object({ id }).strict() satisfies z.ZodType<IpcRequest<'items:openOriginal'>>,
  'items:revealInFinder': z.object({ id }).strict() satisfies z.ZodType<IpcRequest<'items:revealInFinder'>>,
  'items:quickLook': z.object({ id }).strict() satisfies z.ZodType<IpcRequest<'items:quickLook'>>,
  'items:openUrl': z.object({ id }).strict() satisfies z.ZodType<IpcRequest<'items:openUrl'>>,
  'items:readContent': z.object({ id }).strict() satisfies z.ZodType<IpcRequest<'items:readContent'>>,
  'capture:files': z
    .object({ paths: z.array(text(4096)).min(1).max(2000), mode: z.enum(['copy', 'reference']).optional() })
    .strict() satisfies z.ZodType<IpcRequest<'capture:files'>>,
  'capture:url': z.object({ url: httpUrl }).strict() satisfies z.ZodType<IpcRequest<'capture:url'>>,
  'capture:text': z.object({ text: text(2_000_000).min(1), title: optionalText(300) }).strict() satisfies z.ZodType<
    IpcRequest<'capture:text'>
  >,
  'capture:blob': z.object({ name: text(500), mimeType: text(200), bytes }).strict() satisfies z.ZodType<
    IpcRequest<'capture:blob'>
  >,
  'capture:drop': z
    .object({
      files: z.array(text(4096)).max(2000),
      uriList: optionalText(200_000),
      text: optionalText(2_000_000),
      html: optionalText(2_000_000),
      source: z.enum(['library', 'shelf']),
      collectionId: id.optional()
    })
    .strict() satisfies z.ZodType<IpcRequest<'capture:drop'>>,
  'collections:list': empty satisfies z.ZodType<IpcRequest<'collections:list'>>,
  'collections:create': z
    .object({ name: text(200).min(1), description: optionalText(2000) })
    .strict() satisfies z.ZodType<IpcRequest<'collections:create'>>,
  'collections:createDynamic': z
    .object({ name: text(200).min(1), description: optionalText(2000), query: dynamicQuery })
    .strict() satisfies z.ZodType<IpcRequest<'collections:createDynamic'>>,
  'collections:rename': z
    .object({ id, name: text(200).min(1), description: optionalText(2000) })
    .strict() satisfies z.ZodType<IpcRequest<'collections:rename'>>,
  'collections:delete': z.object({ id }).strict() satisfies z.ZodType<IpcRequest<'collections:delete'>>,
  'collections:addItems': z.object({ id, itemIds: ids }).strict() satisfies z.ZodType<
    IpcRequest<'collections:addItems'>
  >,
  'collections:removeItem': z.object({ id, itemId: id }).strict() satisfies z.ZodType<
    IpcRequest<'collections:removeItem'>
  >,
  'relationships:create': z
    .object({ sourceId: id, targetId: id, type: relationshipType, description: optionalText(1000) })
    .strict() satisfies z.ZodType<IpcRequest<'relationships:create'>>,
  'relationships:remove': z.object({ id }).strict() satisfies z.ZodType<IpcRequest<'relationships:remove'>>,
  'search:quick': z
    .object({ query: text(500), limit: z.number().int().min(1).max(200).optional() })
    .strict() satisfies z.ZodType<IpcRequest<'search:quick'>>,
  'agent:command': z
    .object({
      question: text(4000).min(1),
      itemIds: z.array(id).max(200).optional(),
      template: z.enum(['compare', 'common', 'summarize', 'brief', 'extract', 'custom']).optional(),
      history: z
        .array(
          z.object({
            role: z.enum(['user', 'assistant']),
            content: text(4000).min(1)
          })
        )
        .max(8)
        .optional()
    })
    .strict() satisfies z.ZodType<IpcRequest<'agent:command'>>,
  'agent:cancel': z.object({ runId: id }).strict() satisfies z.ZodType<IpcRequest<'agent:cancel'>>,
  'agent:run': z.object({ id }).strict() satisfies z.ZodType<IpcRequest<'agent:run'>>,
  'agent:undo': z.object({ auditId: id }).strict() satisfies z.ZodType<IpcRequest<'agent:undo'>>,
  'agent:undoRun': z.object({ runId: id }).strict() satisfies z.ZodType<IpcRequest<'agent:undoRun'>>,
  'agent:applyProposals': z.object({ runId: id }).strict() satisfies z.ZodType<IpcRequest<'agent:applyProposals'>>,
  'settings:get': empty satisfies z.ZodType<IpcRequest<'settings:get'>>,
  'settings:update': z
    .object({
      apiKey: text(500).optional(),
      clearApiKey: z.boolean().optional(),
      aiMode: z.enum(['gmi', 'off']).optional(),
      model: text(200).optional(),
      baseUrl: z.string().url().max(500).optional(),
      importMode: z.enum(['copy', 'reference']).optional(),
      theme: z.enum(['system', 'light', 'dark']).optional()
    })
    .strict() satisfies z.ZodType<IpcRequest<'settings:update'>>,
  'settings:testConnection': empty satisfies z.ZodType<IpcRequest<'settings:testConnection'>>,
  'system:stats': empty satisfies z.ZodType<IpcRequest<'system:stats'>>,
  'system:contextMenu': z
    .object({
      kind: z.enum(['item', 'items', 'collection', 'background']),
      ids: z.array(id).max(5000),
      collectionId: id.optional()
    })
    .strict() satisfies z.ZodType<IpcRequest<'system:contextMenu'>>,
  'system:openExternal': z.object({ url: httpUrl }).strict() satisfies z.ZodType<IpcRequest<'system:openExternal'>>,
  'system:chooseFiles': empty satisfies z.ZodType<IpcRequest<'system:chooseFiles'>>,
  'system:revealLibrary': empty satisfies z.ZodType<IpcRequest<'system:revealLibrary'>>,
  'jobs:status': empty satisfies z.ZodType<IpcRequest<'jobs:status'>>
} as const satisfies { [C in IpcChannel]: z.ZodType<IpcRequest<C>> }

export function schemaFor<C extends IpcChannel>(channel: C): z.ZodType<IpcRequest<C>> {
  return REQUEST_SCHEMAS[channel] as unknown as z.ZodType<IpcRequest<C>>
}

/** Human-readable, single-line summary of a zod failure (safe to show in the UI). */
export function describeIssues(error: z.ZodError): string {
  const first = error.issues[0]
  if (!first) return 'Invalid request'
  const path = first.path.length > 0 ? `${first.path.map(String).join('.')}: ` : ''
  return `${path}${first.message}`
}
