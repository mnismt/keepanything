import { runOrganizeBatch } from '../../agent/tasks/organize'
import type { StageDefinition } from '../../ports'

/**
 * `organize_batch` stage (ai lane, batch-level): when the batch gate closes, one
 * `organizePlanSchema` call over the batch's understandings, per-item candidates, existing
 * collections and suppressions; applied conservatively through the services. Schedules a
 * `consolidate` sweep every few batches.
 */
export const organizeBatchStage: StageDefinition = {
  name: 'organize_batch',
  lane: 'ai',
  timeoutMs: 600000,
  run: (ctx) => runOrganizeBatch(ctx)
}
