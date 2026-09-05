/**
 * Product-voice descriptions of agent runs for the activity timeline and the status stack.
 */
import type { AgentResult, AgentRunStatus, AgentTask } from '../../../shared/types'

/** Facts about a run this module needs (a subset of `RunState` / `AgentRunSummary`). */
export interface RunLike {
  task: AgentTask
  status: AgentRunStatus
  result?: AgentResult | null
  error?: { message: string } | null
}

/** Title of a run by task, past tense when finished. */
export function runTitle(run: Pick<RunLike, 'task' | 'status'>): string {
  const running = run.status === 'running'
  switch (run.task) {
    case 'understand':
      return running ? 'Understanding' : 'Understood'
    case 'organize':
    case 'organize_batch':
      return running ? 'Finding connections' : 'Organized'
    case 'consolidate':
      return running ? 'Tidying collections' : 'Tidied collections'
    case 'folder':
      return running ? 'Reading the folder' : 'Read the folder'
    case 'command':
      return running ? 'Looking through your library' : 'Answered'
  }
}

/** One line summarising what a finished run did; empty while running. */
export function runOutcome(run: RunLike): string {
  if (run.status === 'running') return ''
  if (run.status === 'cancelled') return 'Stopped.'
  if (run.status === 'failed') return run.error?.message ? `Didn't finish: ${run.error.message}` : "Didn't finish."
  const r = run.result
  if (!r) return 'Done.'
  switch (r.task) {
    case 'understand':
      return r.skippedFields.length > 0
        ? `Understood (kept your edits to ${r.skippedFields.join(', ')}).`
        : 'Understood.'
    case 'organize':
    case 'organize_batch':
    case 'consolidate': {
      const parts: string[] = []
      if (r.relationshipIds.length > 0)
        parts.push(
          r.relationshipIds.length === 1 ? 'Found 1 related thing' : `Found ${r.relationshipIds.length} related things`
        )
      if (r.collectionIds.length > 0)
        parts.push(
          r.collectionIds.length === 1 ? 'Added to 1 collection' : `Added to ${r.collectionIds.length} collections`
        )
      if (r.task === 'consolidate' && r.renamedCollectionIds.length > 0)
        parts.push(`Renamed ${r.renamedCollectionIds.length}`)
      return parts.length > 0 ? `${parts.join(' · ')}.` : r.summary || 'Nothing to connect yet.'
    }
    case 'folder':
      return r.collectionId ? 'Read the folder and made a collection for it.' : 'Read the folder.'
    case 'command':
      return r.kind === 'note'
        ? 'Wrote a note.'
        : r.sources.length > 0
          ? `Answered from ${r.sources.length} ${r.sources.length === 1 ? 'source' : 'sources'}.`
          : 'Nothing matched.'
  }
}

export function runHeadline(run: Pick<RunLike, 'task' | 'status'>, latestStep?: string): string {
  const title = runTitle(run)
  return latestStep ? `${title} · ${latestStep}` : title
}
