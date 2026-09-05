import { COPY, LIMITS } from '../../../shared/constants'
import { STATUS_LABEL } from '../../../shared/status'
import type { Item } from '../../../shared/types'
import { writeContentFile } from '../../extraction/content'
import { extractItem } from '../../extraction/registry'
import { capText, type ExtractionDeps, type ExtractionObjectStore, squash } from '../../extraction/types'
import { pathExistsSync } from '../../lib/fs'
import type { StageContext, StageDefinition, StagePatch } from '../../ports'
import { managedFile } from '../../previews/paths'
import { createObjectStore, type ObjectStore } from '../../storage/object-store'

/**
 * `extract` stage (io lane): run the adapter for the item's type, write the body to
 * `content/<id>.{md,txt}`, and return text/excerpt/title/metadata as a `StagePatch`. URL fetches
 * are cached under `url-cache/` so retries and reprocessing work offline. Idempotent: identical
 * input -> identical patch and no duplicate files.
 */

/** Text/markdown/note items already hold their body as the original; no second copy is written. */
const OWN_BODY_TYPES = new Set<Item['type']>(['text', 'markdown', 'note'])

export function extractionDepsFrom(ctx: StageContext): ExtractionDeps {
  const objectStore = (ctx.deps.objectStore as ObjectStore | undefined) ?? createObjectStore(ctx.paths)
  const store: ExtractionObjectStore = {
    writeBytes: (itemId, name, bytes) => objectStore.writeBytes(itemId, name, bytes),
    resolve: (managedPath) => objectStore.resolve(managedPath)
  }
  return {
    logger: ctx.logger,
    clock: ctx.clock,
    signal: ctx.signal,
    urlCacheDir: ctx.paths.urlCacheDir,
    objectStore: store,
    ...(ctx.deps.worker ? { worker: ctx.deps.worker } : {}),
    ...(ctx.deps.pageFetcher ? { pageFetcher: ctx.deps.pageFetcher } : {}),
    ...(typeof ctx.deps.fetchImpl === 'function'
      ? { fetchImpl: ctx.deps.fetchImpl as ExtractionDeps['fetchImpl'] }
      : {})
  }
}

/** Managed copy first, referenced original second. */
export function sourceFile(ctx: StageContext, item: Item): string | null {
  if (item.managedPath) {
    const abs = managedFile(ctx.paths, item.managedPath)
    if (abs) return abs
  }
  return item.originalPath
}

export async function runExtract(ctx: StageContext): Promise<StagePatch> {
  const item = ctx.item
  if (!item) throw new Error('extract needs an item')
  const filePath = sourceFile(ctx, item)
  if (item.type !== 'url' && item.type !== 'folder' && (!filePath || !pathExistsSync(filePath))) {
    // Captured text already carries its body; anything else without bytes is kept but unread.
    if (item.extractedText) return { outcome: 'ok', metadataPatch: { content: null } }
    return {
      outcome: 'partial',
      message: STATUS_LABEL.EXTRACTION_FAILED,
      metadataPatch: { unreadable: 'Original file not found' }
    }
  }
  const deps = extractionDepsFrom(ctx)
  const content = await extractItem({ item, filePath }, deps)
  if (ctx.signal.aborted) throw new Error('extract cancelled')

  const contentFile = OWN_BODY_TYPES.has(item.type)
    ? null
    : await writeContentFile(ctx.paths.contentDir, item.id, content)
  const text = capText(content.text, LIMITS.maxExtractedChars)
  const { excerpt: metaExcerpt, ...meta } = content.meta
  const excerpt =
    (typeof metaExcerpt === 'string' && metaExcerpt.length > 0
      ? metaExcerpt
      : squash(text.text, LIMITS.excerptChars)) || null

  const patch: StagePatch = {
    outcome: content.partial && content.text.length === 0 ? 'partial' : 'ok',
    item: {
      ...(content.item ?? {}),
      extractedText: text.text.length > 0 ? text.text : item.extractedText,
      excerpt: excerpt ?? item.excerpt
    },
    metadataPatch: {
      ...meta,
      content: contentFile,
      truncated: content.truncated || text.truncated
    }
  }
  const columns = patch.item as NonNullable<StagePatch['item']>
  if (content.title && !item.userOverrides.title && content.title !== item.title) columns.title = content.title
  if (content.pageCount !== undefined) columns.pageCount = content.pageCount
  if (content.dims && (item.width === null || item.height === null)) {
    columns.width = content.dims.width
    columns.height = content.dims.height
  }
  if (content.followUp && content.followUp.length > 0) patch.followUp = content.followUp
  if (content.error) patch.error = content.error
  if (patch.outcome === 'partial' && item.type === 'url') patch.message = COPY.cantReadPage
  return patch
}

export const extractStage: StageDefinition = {
  name: 'extract',
  lane: 'io',
  timeoutMs: 90_000,
  run: runExtract
}
