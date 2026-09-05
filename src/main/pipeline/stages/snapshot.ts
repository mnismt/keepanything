import { KaError } from '../../core/errors'
import type { StageContext, StageDefinition, StagePatch } from '../../ports'
import { snapshotFile, snapshotFullFile, snapshotFullRelPath, snapshotRelPath } from '../../previews/paths'
import { isPdfUrl } from '../../previews/snapshot'

/**
 * `snapshot` stage (io lane): URL items only. Renders the page offscreen into
 * `snapshots/<id>.png` (+ a full-page JPEG when small enough), records size, dominant colour and
 * the rendered title. PDF links skip (their thumbnail comes from the downloaded file). Without a
 * `Snapshotter` in deps the stage is `NOT_IMPLEMENTED` (-> `partial`, "Skipped for now.").
 */

/** True when the item's URL points at a PDF (by header discovered during extract, or by path). */
export function isPdfItem(item: NonNullable<StageContext['item']>): boolean {
  return (
    item.mimeType === 'application/pdf' || item.metadata.urlKind === 'pdf' || (item.url ? isPdfUrl(item.url) : false)
  )
}

/** True when the capture-time title was derived from the URL (safe to replace with the page title). */
export function isProvisionalTitle(item: NonNullable<StageContext['item']>): boolean {
  if (!item.domain) return false
  return item.title === item.domain || item.title.endsWith(` · ${item.domain}`)
}

export async function runSnapshot(ctx: StageContext): Promise<StagePatch> {
  const item = ctx.item
  if (!item) throw new Error('snapshot needs an item')
  if (item.type !== 'url' || !item.url) return { outcome: 'ok', metadataPatch: { snapshot: { skipped: 'not a url' } } }
  if (isPdfItem(item)) return { outcome: 'ok', metadataPatch: { snapshot: { skipped: 'pdf' } } }
  const snapshotter = ctx.deps.snapshotter
  if (!snapshotter) throw new KaError('NOT_IMPLEMENTED', 'no snapshotter in this build')

  const result = await snapshotter.snapshot(item.url, snapshotFile(ctx.paths, item.id), {
    signal: ctx.signal,
    fullPagePath: snapshotFullFile(ctx.paths, item.id)
  })
  if (ctx.signal.aborted) throw new Error('snapshot cancelled')
  if (!result) {
    return { outcome: 'partial', error: 'Snapshot failed', metadataPatch: { snapshot: null } }
  }
  const patch: StagePatch = {
    outcome: 'ok',
    item: { snapshotPath: snapshotRelPath(item.id) },
    metadataPatch: {
      snapshot: {
        width: result.width,
        height: result.height,
        title: result.title ?? null,
        finalUrl: result.finalUrl ?? null,
        fullPage: result.fullPage
          ? { path: snapshotFullRelPath(item.id), width: result.fullPage.width, height: result.fullPage.height }
          : null
      }
    }
  }
  const columns = patch.item as NonNullable<StagePatch['item']>
  if (result.dominantColor && !item.dominantColor) columns.dominantColor = result.dominantColor
  if (result.title && isProvisionalTitle(item) && !item.userOverrides.title) columns.title = result.title.slice(0, 200)
  if (item.snapshotPath) columns.mediaVersion = item.mediaVersion + 1
  return patch
}

export const snapshotStage: StageDefinition = {
  name: 'snapshot',
  lane: 'io',
  timeoutMs: 45_000,
  run: runSnapshot
}
