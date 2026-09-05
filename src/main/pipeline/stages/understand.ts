import { runUnderstand } from '../../agent/tasks/understand'
import type { StageDefinition } from '../../ports'

/**
 * `understand` stage (ai lane): one structured call per item (`understandingSchema`, or
 * `folderUnderstandingSchema` for folders) with capped text, compact metadata and the prepared
 * preview as an image part. Writes understanding columns through the patch, honouring
 * `user_overrides`. Provider errors propagate so the scheduler parks the job; schema failures
 * return `outcome: 'failed'`.
 */
export const understandStage: StageDefinition = {
  name: 'understand',
  lane: 'ai',
  timeoutMs: 180000,
  run: (ctx) => runUnderstand(ctx)
}
