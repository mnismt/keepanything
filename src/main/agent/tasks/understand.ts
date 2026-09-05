import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { COPY, LIMITS } from '../../../shared/constants'
import type { Item, Understanding, UserOverridableField } from '../../../shared/types'
import {
  buildFolderRequest,
  buildUnderstandRequest,
  type FolderInput,
  folderUnderstandingSchema,
  type UnderstandInput,
  understandingSchema
} from '../../ai'
import { isKaError } from '../../core/errors'
import type { Logger, Paths, StageContext, StagePatch } from '../../ports'
import { requireItem, startTaskRun, structuredCall, taskServices, toAgentUsage } from './common'

/** Largest preview we attach (base64 grows it by ~33 %; ≤ 1280 px ≈ 1.5k tokens). */
export const MAX_IMAGE_BYTES = 3_000_000

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
}

/** Read a preview file as a `data:` URI, or null when absent / too large / not an image. */
export async function previewDataUri(path: string, logger?: Logger): Promise<string | null> {
  const mime = IMAGE_MIME[extname(path).toLowerCase()]
  if (!mime) return null
  try {
    const bytes = await readFile(path)
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) return null
    return `data:${mime};base64,${bytes.toString('base64')}`
  } catch (error) {
    logger?.debug('understand.preview_unreadable', { path, error })
    return null
  }
}

/** Which prepared previews to send for an item (snapshot first for pages, thumbnail otherwise). */
export async function previewsFor(item: Item, paths: Paths, logger?: Logger): Promise<string[]> {
  const candidates: string[] = []
  if (item.type === 'url' && item.snapshotPath) candidates.push(join(paths.snapshotsDir, item.snapshotPath))
  if ((item.type === 'image' || item.type === 'pdf' || item.type === 'url') && item.thumbnailPath)
    candidates.push(join(paths.thumbsDir, item.thumbnailPath))
  // For pages the snapshot is enough; otherwise one thumbnail.
  for (const path of candidates) {
    const uri = await previewDataUri(path, logger)
    if (uri) return [uri]
  }
  return []
}

/** Compact metadata for the prompt (never the whole blob). */
export function compactMetadata(item: Item): Record<string, unknown> {
  const m = item.metadata
  const out: Record<string, unknown> = {}
  if (m.og) out.og = m.og
  if (m.siteName) out.siteName = m.siteName
  if (m.description) out.description = m.description
  if (m.repo) {
    const { owner, name, description, language, stars, topics, license } = m.repo
    out.repo = { owner, name, description, language, stars, topics: topics?.slice(0, 10), license }
  }
  if (m.folder) {
    out.folder = { fileCount: m.folder.fileCount, dirCount: m.folder.dirCount, extensions: m.folder.extensions }
  }
  if (Array.isArray(m.headings) && m.headings.length > 0) out.headings = m.headings.slice(0, 12)
  if (m.originalName) out.originalName = m.originalName
  if (m.sourceUrl) out.sourceUrl = m.sourceUrl
  if (item.pageCount) out.pageCount = item.pageCount
  if (item.width && item.height) out.dimensions = `${item.width}×${item.height}`
  if (item.size) out.bytes = item.size
  return out
}

/** Build the patch for an understanding, skipping fields the user edited by hand. */
export function understandingPatch(
  item: Item,
  understanding: Understanding
): { patch: NonNullable<StagePatch['item']>; skipped: UserOverridableField[] } {
  const skipped: UserOverridableField[] = []
  const patch: NonNullable<StagePatch['item']> = {}
  const set = <K extends UserOverridableField>(field: K, value: Item[K]): void => {
    if (item.userOverrides[field]) skipped.push(field)
    else (patch as Record<string, unknown>)[field] = value
  }
  const title = understanding.title.trim()
  set('title', title.length > 0 ? title.slice(0, 160) : item.title)
  set('understanding', understanding.summary)
  set('whyUseful', understanding.whyUseful)
  set('kind', understanding.kind)
  set('topics', understanding.topics)
  set('entities', understanding.entities)
  const vision = [understanding.visualDescription, understanding.visibleText]
    .filter((s): s is string => !!s && s.trim().length > 0)
    .join('\n\n')
  patch.visionText = vision.length > 0 ? vision : null
  patch.retrievalHints = understanding.retrievalHints
  patch.aiConfidence = understanding.confidence
  return { patch, skipped }
}

function folderInput(item: Item, children: Item[], textBudget: number): FolderInput {
  const folder = item.metadata.folder
  const rawSamples = (item.metadata as { folder?: { samples?: unknown } }).folder?.samples
  const samples: FolderInput['samples'] = []
  if (Array.isArray(rawSamples)) {
    for (const sample of rawSamples) {
      if (
        typeof sample === 'object' &&
        sample !== null &&
        typeof (sample as { path?: unknown }).path === 'string' &&
        typeof (sample as { excerpt?: unknown }).excerpt === 'string'
      ) {
        samples.push({ path: (sample as { path: string }).path, excerpt: (sample as { excerpt: string }).excerpt })
      }
    }
  }
  if (samples.length === 0) {
    for (const child of children) {
      if (!child.extractedText) continue
      samples.push({ path: child.title, excerpt: child.extractedText.slice(0, 2_000) })
      if (samples.length >= LIMITS.folderSampleFiles) break
    }
  }
  const perSample = Math.max(200, Math.floor(textBudget / Math.max(1, samples.length)))
  const input: FolderInput = {
    title: item.title,
    structure: {
      fileCount: folder?.fileCount ?? children.length,
      dirCount: folder?.dirCount ?? 0,
      totalBytes: folder?.totalBytes ?? 0,
      extensions: folder?.extensions ?? {}
    },
    samples: samples.map((s) => ({ path: s.path, excerpt: s.excerpt.slice(0, perSample) })),
    children: children
      .slice(0, 60)
      .map((c) => ({ id: c.id, title: c.title, kind: c.kind, understanding: c.understanding })),
    capturedAt: item.capturedAt
  }
  if (folder?.truncated !== undefined) input.structure.truncated = folder.truncated
  if (folder?.tree) input.structure.tree = folder.tree
  if (item.metadata.originalName) input.path = String(item.metadata.originalName)
  return input
}

export async function runUnderstand(ctx: StageContext): Promise<StagePatch> {
  const item = requireItem(ctx)
  if (item.type === 'note') return { outcome: 'ok' }
  const s = taskServices(ctx.deps)
  const logger = ctx.logger.child({ task: 'understand' })
  const run = startTaskRun(s, ctx.clock, { task: item.type === 'folder' ? 'folder' : 'understand', itemId: item.id })
  try {
    if (item.type === 'folder') {
      const children = s.repos.items.children(item.id)
      run.step({ tool: 'inspect_folder', kind: 'inspect', label: `Looking through "${item.title}"`, status: 'ok' })
      const outcome = await structuredCall(
        s.ai,
        folderUnderstandingSchema,
        (budget) => buildFolderRequest(folderInput(item, children, budget), ctx.signal),
        { textBudget: LIMITS.understandTextChars, logger }
      )
      if (!outcome.ok) {
        run.fail(outcome.message, toAgentUsage(outcome.usage, 1))
        return {
          outcome: 'failed',
          message: COPY.stillFiguring,
          error: `understand: ${outcome.failure}: ${outcome.message}`
        }
      }
      const { patch, skipped } = understandingPatch(item, outcome.value.understanding)
      let collectionId: string | undefined
      const proposal = outcome.value.collection
      if (proposal && s.collections && children.length >= 3 && proposal.confidence >= 0.7) {
        try {
          const created = s.collections.create({
            name: proposal.name,
            description: proposal.description,
            createdBy: 'agent',
            agentRunId: run.id
          })
          s.collections.addItems(
            created.id,
            children.map((c) => ({
              itemId: c.id,
              confidence: proposal.confidence,
              reason: `In the folder "${item.title}".`
            })),
            { actor: 'agent', agentRunId: run.id }
          )
          collectionId = created.id
          run.step({ tool: 'create_collection', kind: 'write', label: `Created "${created.name}"`, status: 'ok' })
        } catch (error) {
          logger.info('folder collection skipped', { error })
        }
      }
      run.succeed(
        {
          task: 'folder',
          itemId: item.id,
          understanding: outcome.value.understanding,
          ...(collectionId ? { collectionId } : {}),
          summary: outcome.value.purpose
        },
        toAgentUsage(outcome.usage, 1)
      )
      return {
        outcome: 'ok',
        item: patch,
        metadataPatch: { folder: { purpose: outcome.value.purpose, keyFiles: outcome.value.keyFiles } },
        ...(skipped.length > 0 ? { message: 'Kept your edits.' } : {})
      }
    }

    const images = await previewsFor(item, ctx.paths, logger)
    run.step({
      tool: 'inspect_item',
      kind: 'inspect',
      label: images.length > 0 ? `Looking at "${item.title}"` : `Reading "${item.title}"`,
      itemIds: [item.id],
      status: 'ok'
    })
    const base: Omit<UnderstandInput, 'text'> = {
      title: item.title,
      type: item.type,
      subtype: item.subtype,
      url: item.url,
      domain: item.domain,
      mimeType: item.mimeType,
      metadata: compactMetadata(item),
      images,
      capturedAt: item.capturedAt
    }
    const outcome = await structuredCall(
      s.ai,
      understandingSchema,
      (budget) => buildUnderstandRequest({ ...base, text: item.extractedText?.slice(0, budget) ?? null }, ctx.signal),
      { textBudget: LIMITS.understandTextChars, logger }
    )
    if (!outcome.ok) {
      run.fail(outcome.message, toAgentUsage(outcome.usage, 1))
      return {
        outcome: 'failed',
        message: COPY.stillFiguring,
        error: `understand: ${outcome.failure}: ${outcome.message}`
      }
    }
    const { patch, skipped } = understandingPatch(item, outcome.value)
    run.succeed(
      { task: 'understand', itemId: item.id, understanding: outcome.value, skippedFields: skipped },
      toAgentUsage(outcome.usage, 1)
    )
    logger.info('understood', {
      itemId: item.id,
      kind: outcome.value.kind,
      confidence: outcome.value.confidence,
      images: images.length,
      promptTokens: outcome.usage.promptTokens,
      latencyMs: outcome.usage.latencyMs
    })
    return { outcome: 'ok', item: patch, ...(skipped.length > 0 ? { message: 'Kept your edits.' } : {}) }
  } catch (error) {
    run.fail(isKaError(error) ? error.message : COPY.stillFiguring)
    throw error
  }
}
