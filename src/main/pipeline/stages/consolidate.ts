import { runConsolidate } from '../../agent/tasks/consolidate'
import type { StageDefinition } from '../../ports'

/**
 * `consolidate` stage (ai lane, batch-level): a library-wide tidy-up with
 * `consolidatePlanSchema`; renames/merges only touch agent-created near-duplicate collections and
 * every change is audited and undoable.
 */
export const consolidateStage: StageDefinition = {
  name: 'consolidate',
  lane: 'ai',
  timeoutMs: 900000,
  run: (ctx) => runConsolidate(ctx)
}
