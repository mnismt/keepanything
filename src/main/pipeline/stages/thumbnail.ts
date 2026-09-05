import { basename } from 'node:path'
import { LIMITS } from '../../../shared/constants'
import { STATUS_LABEL } from '../../../shared/status'
import { KaError } from '../../core/errors'
import { inspectImage } from '../../extraction/image'
import { pathExistsSync } from '../../lib/fs'
import type { StageContext, StageDefinition, StagePatch } from '../../ports'
import { thumbnailFile, thumbnailRelPath, visionFile, visionRelPath } from '../../previews/paths'
import { sourceFile } from './extract'

/**
 * `thumbnail` stage (io lane): `thumbs/<id>.png` with real width/height and a dominant
 * colour. Images additionally get dimensions/EXIF/subtype from their header and a ≤1280 px vision
 * JPEG under `content/` for the understand task. Without a `Thumbnailer` in deps the stage is
 * `NOT_IMPLEMENTED` (scheduler -> `partial`, "Skipped for now.").
 */

/** Longest side of the vision image handed to the model. */
export const VISION_MAX_PX = 1280

export async function runThumbnail(ctx: StageContext): Promise<StagePatch> {
  const item = ctx.item
  if (!item) throw new Error('thumbnail needs an item')
  const thumbnailer = ctx.deps.thumbnailer
  if (!thumbnailer) throw new KaError('NOT_IMPLEMENTED', 'no thumbnailer in this build')
  const filePath = sourceFile(ctx, item)
  if (!filePath || !pathExistsSync(filePath)) {
    return { outcome: 'partial', message: STATUS_LABEL.EXTRACTION_FAILED, metadataPatch: { thumb: null } }
  }

  const patch: StagePatch = { outcome: 'ok', item: {}, metadataPatch: {} }
  const columns = patch.item as NonNullable<StagePatch['item']>
  const meta = patch.metadataPatch as Record<string, unknown>

  if (item.type === 'image') {
    const name = item.metadata.originalName ?? basename(filePath)
    const { info, subtype } = await inspectImage(filePath, name)
    if (info?.width && info.height) {
      columns.width = info.width
      columns.height = info.height
    }
    if (!item.subtype || item.subtype === 'generic') columns.subtype = subtype
    meta.image = { format: info?.format ?? null }
    if (info?.exif) meta.exif = info.exif
    if (ctx.signal.aborted) throw new Error('thumbnail cancelled')
    const vision = await thumbnailer.visionImage(filePath, visionFile(ctx.paths, item.id), VISION_MAX_PX, ctx.signal)
    meta.visionImage = vision ? { path: visionRelPath(item.id), width: vision.width, height: vision.height } : null
  }

  if (ctx.signal.aborted) throw new Error('thumbnail cancelled')
  const thumbPath = thumbnailFile(ctx.paths, item.id)
  const thumb = await thumbnailer.thumbnail(filePath, thumbPath, LIMITS.thumbnailMaxPx, ctx.signal)
  if (!thumb) {
    meta.thumb = null
    patch.outcome = item.type === 'image' ? 'partial' : 'ok'
    patch.error = 'No preview could be made'
    return patch
  }
  columns.thumbnailPath = thumbnailRelPath(item.id)
  meta.thumb = { width: thumb.width, height: thumb.height }
  if (item.type !== 'image' && (item.width === null || item.height === null) && columns.width === undefined) {
    columns.width = thumb.width
    columns.height = thumb.height
  }
  const colour = await thumbnailer.dominantColorOf(thumbPath)
  if (colour) columns.dominantColor = colour
  if (item.thumbnailPath) columns.mediaVersion = item.mediaVersion + 1
  return patch
}

export const thumbnailStage: StageDefinition = {
  name: 'thumbnail',
  lane: 'io',
  timeoutMs: 45_000,
  run: runThumbnail
}
