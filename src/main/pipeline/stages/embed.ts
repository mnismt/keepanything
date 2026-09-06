import type { StageDefinition } from '../../ports'
import type { RetrievalService } from '../../retrieval'

/**
 * `embed` stage (embed lane): body chunks (`chunk_index ≥ 1`, role `body`) of the item's
 * extracted text through the active embedding provider, stored with model id + dims. Idempotent:
 * unchanged text and model is a no-op; hash-fallback rows carry their own model id, so a later
 * model arrival re-embeds on the next run. Embeddings are not required to proceed: without a
 * retrieval service the stage is a no-op.
 */
export const embedStage: StageDefinition = {
  name: 'embed',
  lane: 'embed',
  timeoutMs: 120000,
  run: async (ctx) => {
    if (!ctx.itemId) return { outcome: 'ok' }
    const retrieval = ctx.deps.retrieval as RetrievalService | undefined
    if (!retrieval || typeof retrieval.embedBody !== 'function') {
      ctx.logger.debug('embed: no retrieval service; skipping')
      return { outcome: 'ok' }
    }
    const result = await retrieval.embedBody(ctx.itemId)
    ctx.logger.debug('embedded', { ...result })
    return { outcome: 'ok' }
  }
}
