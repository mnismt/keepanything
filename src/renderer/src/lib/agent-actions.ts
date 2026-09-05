/**
 * Run-level agent actions shared by the status stack, the palette and the activity panel: undo a
 * whole run and apply its staged proposals.
 */
import type { AgentProposal } from '../../../shared/types'
import { useRuns } from '../state/runs'
import { useToasts } from '../state/toasts'
import { count } from './format'
import { describeError, invoke } from './ipc-client'

/** Revert every audited change of a run. Resolves true when main reverted at least one. */
export async function undoRun(runId: string): Promise<boolean> {
  const r = await invoke('agent:undoRun', { runId })
  if (!r.ok) {
    useToasts.getState().push({ text: describeError(r.error) })
    return false
  }
  useRuns.getState().markUndone(runId)
  useToasts.getState().push({ text: r.data.undone > 0 ? 'Undone.' : 'Nothing left to undo.' })
  return r.data.undone > 0
}

/** Apply the staged proposals of a run; the toast offers Undo for the whole run. */
export async function applyProposals(runId: string): Promise<{ applied: number; remaining: AgentProposal[] } | null> {
  const r = await invoke('agent:applyProposals', { runId })
  if (!r.ok) {
    useToasts.getState().push({ text: describeError(r.error) })
    return null
  }
  const { applied, remaining } = r.data
  if (applied > 0) {
    useToasts.getState().push({
      text: `Applied ${count(applied, 'change')}.`,
      ...(remaining.length > 0 ? { detail: `${count(remaining.length, 'proposal')} could not be applied.` } : {}),
      action: { label: 'Undo', run: () => undoRun(runId) }
    })
  } else {
    useToasts.getState().push({ text: "Couldn't apply those changes." })
  }
  return r.data
}
