import type { StageDefinition } from '../../ports'
import type { Repositories } from '../../storage/repositories'

/**
 * `index` stage (embed lane): refreshes the FTS row from the current columns and embeds
 * the memory document as chunk 0 via `Retrieval.indexItem` (idempotent). Lives in `index-stage.ts`
 * because `stages/index.ts` is the frozen list. Without a retrieval service only the FTS row is
 * resynced through the item repository.
 */
export const indexStage: StageDefinition = {
  name: 'index',
  lane: 'embed',
  timeoutMs: 60000,
  run: async (ctx) => {
    if (!ctx.itemId) return { outcome: 'ok' }
    if (ctx.deps.retrieval) {
      await ctx.deps.retrieval.indexItem(ctx.itemId)
      return { outcome: 'ok' }
    }
    const repos = ctx.deps.repos as Repositories | undefined
    repos?.items.syncFts(ctx.itemId)
    return { outcome: 'ok' }
  }
}
