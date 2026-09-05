import { runRelate } from '../../agent/tasks/organize'
import type { StageDefinition } from '../../ports'

/**
 * `relate` stage (ai lane): candidates from retrieval (cosine top-12 ∪ FTS ∪ same
 * domain/folder/batch), the deterministic near-duplicate rule, then one `organizePlanSchema` call.
 * Relationships (≥ 0.7, ≤ 5 per item) and memberships are created through the services with audit
 * rows; suppressed pairs are skipped.
 */
export const relateStage: StageDefinition = {
  name: 'relate',
  lane: 'ai',
  timeoutMs: 300000,
  run: (ctx) => runRelate(ctx)
}
