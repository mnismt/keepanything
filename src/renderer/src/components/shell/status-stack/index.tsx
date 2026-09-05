import * as stylex from '@stylexjs/stylex'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { STAGE_LABEL, STATUS_LABEL } from '../../../../../shared/status'
import type { JobProgress } from '../../../../../shared/types'
import { runOutcome, runTitle } from '../../../lib/activity'
import { undoRun } from '../../../lib/agent-actions'
import { count } from '../../../lib/format'
import { describeError, invoke } from '../../../lib/ipc-client'
import { useJobs } from '../../../state/jobs'
import { useLibrary } from '../../../state/library'
import { type RunState, selectActiveRuns, useRuns } from '../../../state/runs'
import { useToasts } from '../../../state/toasts'
import { useUi } from '../../../state/ui'
import { shared } from '../../../styles/shared'
import { Dot, RevealText, ToastStack } from '../../common'
import { styles } from './styles'

function active(j: JobProgress): boolean {
  return j.jobStatus === 'running' || j.jobStatus === 'queued'
}

/** One or more items in flight: collapsed headline, expandable per-item lines, failures with Retry. */
function JobsEntry({ jobs, failed }: { jobs: JobProgress[]; failed: JobProgress[] }): React.JSX.Element | null {
  const byId = useLibrary((s) => s.byId)
  const push = useToasts((s) => s.push)
  const [open, setOpen] = useState(false)
  const titleOf = (id: string | null): string => (id ? (byId[id]?.title ?? 'An item') : 'A batch')
  const understood = jobs.filter((j) => j.processingStatus === 'RELATING').length
  const first = jobs[0]
  if (jobs.length === 0 && failed.length === 0) return null

  const retry = async (j: JobProgress): Promise<void> => {
    if (!j.itemId) return
    const ok = await useLibrary.getState().reprocess(j.itemId)
    push({ text: ok ? 'Trying again.' : "Couldn't retry right now." })
  }

  const headline =
    jobs.length === 0
      ? failed.length === 1
        ? `Couldn't finish ${titleOf(failed[0]?.itemId ?? null)}`
        : `Couldn't finish ${count(failed.length, 'item')}`
      : jobs.length === 1 && first
        ? `${STAGE_LABEL[first.stage]} · ${titleOf(first.itemId)}`
        : `Keeping ${count(jobs.length, 'item')}${understood > 0 ? ` · ${understood} understood` : ''}`

  const expandable = jobs.length > 1 || failed.length > 0

  return (
    <div {...stylex.props(styles.entry)}>
      <div {...stylex.props(styles.line)}>
        <Dot tone={jobs.length > 0 ? 'processing' : 'failed'} />
        <span {...stylex.props(styles.lineText, shared.ellipsis)}>{headline}</span>
        {expandable ? (
          <button
            type="button"
            {...stylex.props(shared.hoverFade, styles.toggle)}
            aria-label={open ? 'Hide details' : 'Show details'}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <ChevronDown size={14} strokeWidth={1.5} /> : <ChevronUp size={14} strokeWidth={1.5} />}
          </button>
        ) : null}
      </div>
      {open || (jobs.length === 0 && failed.length <= 2) ? (
        <div {...stylex.props(styles.rows)}>
          {jobs.map((j) => (
            <span key={`${j.itemId ?? j.batchId}-${j.stage}`} {...stylex.props(styles.row)}>
              <span {...stylex.props(styles.rowTitle, shared.ellipsis)}>{titleOf(j.itemId)}</span>
              <span {...stylex.props(styles.rowStage)}>
                {j.jobStatus === 'queued' ? 'Waiting' : STAGE_LABEL[j.stage]}
              </span>
            </span>
          ))}
          {failed.map((j) => (
            <span key={`${j.itemId ?? j.batchId}-${j.stage}-failed`} {...stylex.props(styles.row)}>
              <Dot tone="failed" />
              <span {...stylex.props(styles.rowTitle, shared.ellipsis)} title={j.message}>
                {titleOf(j.itemId)}
                {j.processingStatus ? (
                  <span {...stylex.props(styles.rowStage)}> · {STATUS_LABEL[j.processingStatus]}</span>
                ) : null}
              </span>
              {j.itemId ? (
                <button type="button" {...stylex.props(shared.hoverFade, styles.action)} onClick={() => void retry(j)}>
                  Retry
                </button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function RunEntry({ run }: { run: RunState }): React.JSX.Element {
  const openRun = useUi((s) => s.openRun)
  const last = run.steps[run.steps.length - 1]
  return (
    <div {...stylex.props(styles.entry)}>
      <div {...stylex.props(styles.line)}>
        <Dot tone="processing" />
        <RevealText style={[styles.lineText, shared.ellipsis]} text={runTitle(run)} />
        {run.task === 'command' ? (
          <button type="button" {...stylex.props(shared.hoverFade, styles.action)} onClick={() => openRun(run.runId)}>
            Show
          </button>
        ) : null}
        <button
          type="button"
          {...stylex.props(shared.hoverFade, styles.action)}
          onClick={() => void invoke('agent:cancel', { runId: run.runId })}
        >
          Cancel
        </button>
      </div>
      {last ? (
        <div {...stylex.props(styles.steps)}>
          {run.steps.slice(-3).map((s) => (
            <span key={s.n} {...stylex.props(shared.ellipsis, styles.stepEnter)}>
              <RevealText text={s.label} reveal durationMs={420} />
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Announces finished background runs (organize / understand) as toasts, once each: the final
 * line comes only from real results ("Found 4 related things · Added to 1 collection.").
 */
function useRunAnnouncements(): void {
  const runs = useRuns((s) => s.runs)
  const announced = useRef<Set<string>>(new Set())
  const push = useToasts((s) => s.push)
  const openRun = useUi((s) => s.openRun)
  const paletteOpen = useUi((s) => s.modalStack.some((m) => m.kind === 'palette'))
  useEffect(() => {
    for (const run of Object.values(runs)) {
      if (run.status === 'running' || announced.current.has(run.runId)) continue
      announced.current.add(run.runId)
      if (run.status === 'cancelled') continue
      if (run.task === 'command') {
        if (paletteOpen) continue
        if (run.status === 'failed')
          push({
            text: run.error ? describeError(run.error) : "That didn't work.",
            action: { label: 'Show', run: () => openRun(run.runId) }
          })
        else if (run.result?.task === 'command' && run.result.kind === 'note' && run.result.noteId) {
          const noteId = run.result.noteId
          push({
            text: 'Wrote a note from your selection.',
            action: {
              label: 'Show',
              run: () => useUi.getState().openDetail(noteId, noteId)
            }
          })
        } else if (run.result?.task === 'command' && (run.result.appliedCount ?? 0) > 0 && run.undoable) {
          // Item actions that applied their own changes: Undo reverts the whole run.
          push({
            text: 'Answer ready.',
            detail: `Applied ${count(run.result.appliedCount ?? 0, 'change')}.`,
            action: { label: 'Undo', run: () => undoRun(run.runId) },
            secondary: { label: 'Show', run: () => openRun(run.runId) }
          })
        } else push({ text: 'Answer ready.', action: { label: 'Show', run: () => openRun(run.runId) } })
        continue
      }
      if (run.task === 'understand') continue
      const line = runOutcome(run)
      if (!line || run.status === 'failed') continue
      const itemId = run.itemId
      const show = itemId
        ? { label: 'Show' as const, run: () => useUi.getState().openDetail(itemId, itemId) }
        : undefined
      push({
        text: line,
        ...(itemId ? { detail: useLibrary.getState().byId[itemId]?.title } : {}),
        // Organize / relate / consolidate runs that wrote something get Undo for the whole run.
        ...(run.undoable
          ? { action: { label: 'Undo' as const, run: () => undoRun(run.runId) }, ...(show ? { secondary: show } : {}) }
          : show
            ? { action: show }
            : {})
      })
    }
  }, [runs, push, openRun, paletteOpen])
}

/**
 * StatusStack (bottom-right): pipeline progress from `jobs`, running agent runs with Cancel,
 * finished-run announcements and the toast stack.
 */
export function StatusStack(): React.JSX.Element {
  const byItem = useJobs((s) => s.byItem)
  const activeRuns = useRuns(useShallow(selectActiveRuns))
  useRunAnnouncements()

  const all = Object.values(byItem)
  const jobs = all.filter(active)
  const failed = all.filter((j) => j.jobStatus === 'failed')

  return (
    <div {...stylex.props(styles.stack)} aria-live="polite">
      <JobsEntry jobs={jobs} failed={failed} />
      {activeRuns
        .filter((r) => r.task !== 'understand')
        .map((run) => (
          <RunEntry key={run.runId} run={run} />
        ))}
      <ToastStack />
    </div>
  )
}
