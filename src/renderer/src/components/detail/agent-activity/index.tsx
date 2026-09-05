import * as stylex from '@stylexjs/stylex'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { AgentRunDetail, AgentRunSummary, AgentStep } from '../../../../../shared/types'
import { runNote, runOutcome, runTitle } from '../../../lib/activity'
import { undoRun } from '../../../lib/agent-actions'
import { ago } from '../../../lib/format'
import { invoke } from '../../../lib/ipc-client'
import { formatElapsed, toolLabel } from '../../../lib/palette'
import { useLibrary } from '../../../state/library'
import { type RunState, useRuns } from '../../../state/runs'
import { shared } from '../../../styles/shared'
import { Dot, ProposalList, RevealText, Thumb } from '../../common'
import { styles } from './styles'

type Entry = { id: string; startedAt: number; live?: RunState; summary?: AgentRunSummary }

function toneFor(status: string): 'processing' | 'failed' | 'ok' | 'neutral' {
  if (status === 'running') return 'processing'
  if (status === 'failed') return 'failed'
  if (status === 'cancelled') return 'neutral'
  return 'ok'
}

const STEP_STAGGER_MS = 40
const STEP_STAGGER_CAP_MS = 320

/**
 * Steps already there when the list mounts (a finished run being expanded) fan in with a short
 * stagger. Steps that arrive later (a live run) enter one at a time with their label sweeping in.
 */
function StepList({ steps }: { steps: AgentStep[] }): React.JSX.Element | null {
  const mountedWith = useRef(steps.length)
  if (steps.length === 0) return null
  return (
    <div {...stylex.props(styles.steps)}>
      {steps.map((s, i) => {
        const atMount = i < mountedWith.current
        const delay = atMount ? Math.min(i * STEP_STAGGER_MS, STEP_STAGGER_CAP_MS) : 0
        return (
          <span key={s.n} {...stylex.props(styles.step, styles.stepEnter(delay))}>
            <span {...stylex.props(styles.stepTool)}>{toolLabel(s.tool)}</span>
            <span
              {...stylex.props(styles.stepLabel, s.status === 'rejected' && styles.stepRejected)}
              title={s.rejectReason}
            >
              <RevealText text={s.label} reveal={!atMount} durationMs={420} />
            </span>
            <span {...stylex.props(styles.stepTime)}>{formatElapsed(s.durationMs)}</span>
          </span>
        )
      })}
    </div>
  )
}

function SourceRow({
  itemId,
  why,
  onOpen
}: {
  itemId: string
  why: string
  onOpen: (id: string) => void
}): React.JSX.Element {
  const item = useLibrary((s) => s.byId[itemId])
  return (
    <button type="button" {...stylex.props(styles.source)} onClick={() => onOpen(itemId)}>
      <span {...stylex.props(styles.sourceThumb)}>
        <Thumb src={item?.thumbnailUrl ?? null} fill={item?.dominantColor} />
      </span>
      <span {...stylex.props(shared.ellipsis)}>
        {item?.title ?? 'An item'}
        {why ? <span {...stylex.props(styles.stepTool)}> · {why}</span> : null}
      </span>
    </button>
  )
}

function ActivityEntry({ entry, onOpenItem }: { entry: Entry; onOpenItem: (id: string) => void }): React.JSX.Element {
  const [open, setOpen] = useState(entry.live?.status === 'running')
  const [fetched, setFetched] = useState<AgentRunDetail | null>(null)
  const [undone, setUndone] = useState(false)
  const [undoing, setUndoing] = useState(false)
  const live = entry.live
  const task = live?.task ?? entry.summary?.task ?? 'understand'
  const status = live?.status ?? entry.summary?.status ?? 'succeeded'
  const result = live?.result ?? fetched?.result ?? null
  const error = live?.error ?? (entry.summary?.error ? { message: entry.summary.error } : null)
  // Summaries carry the steps; the persisted result (answer, proposals) is fetched on demand.
  const steps = live?.steps ?? entry.summary?.steps ?? fetched?.steps ?? []
  const stepCount = live ? live.steps.length : (entry.summary?.stepCount ?? steps.length)
  const undoable = !undone && status === 'succeeded' && (live?.undoable || entry.summary?.undoable || false)
  const startedAt = live && entry.summary ? entry.summary.startedAt : new Date(entry.startedAt).toISOString()
  const completedAt = entry.summary?.completedAt ?? (live?.endedAt ? new Date(live.endedAt).toISOString() : null)

  const undo = async (): Promise<void> => {
    setUndoing(true)
    const ok = await undoRun(entry.id)
    setUndoing(false)
    if (ok) setUndone(true)
  }

  useEffect(() => {
    if (!open || live || fetched || !entry.summary || task !== 'command') return
    let cancelled = false
    void invoke('agent:run', { id: entry.summary.id }).then((r) => {
      if (!cancelled && r.ok) setFetched(r.data)
    })
    return () => {
      cancelled = true
    }
  }, [open, live, fetched, entry.summary])

  const answer = result && result.task === 'command' ? result : null
  const outcome = runOutcome({ task, status, result, error })
  const note = runNote({ task, status, result, error })

  return (
    <div {...stylex.props(styles.entry)}>
      <span {...stylex.props(styles.rail)}>
        <Dot tone={toneFor(status)} />
      </span>
      <div {...stylex.props(styles.body)}>
        <div {...stylex.props(styles.headRow)}>
          <button type="button" {...stylex.props(styles.head)} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            <span {...stylex.props(styles.title)}>{runTitle({ task, status })}</span>
            {stepCount > 0 ? (
              <span {...stylex.props(styles.outcome)}>{stepCount === 1 ? '1 step' : `${stepCount} steps`}</span>
            ) : null}
          </button>
          {undoable ? (
            <button type="button" {...stylex.props(styles.undo)} onClick={() => void undo()} disabled={undoing}>
              {undoing ? 'Undoing…' : 'Undo'}
            </button>
          ) : null}
          <span
            {...stylex.props(styles.when)}
            title={completedAt ? `Started ${startedAt} · finished ${completedAt}` : `Started ${startedAt}`}
          >
            {ago(startedAt)}
          </span>
        </div>
        {outcome ? (
          <span {...stylex.props(styles.outcome, live ? styles.outcomeEnter : null)}>
            {undone ? 'Undone.' : outcome}
          </span>
        ) : null}
        {open ? (
          <>
            <StepList steps={steps} />
            {note ? <p {...stylex.props(styles.answer, shared.selectable)}>{note}</p> : null}
            {answer?.answer ? <p {...stylex.props(styles.answer, shared.selectable)}>{answer.answer}</p> : null}
            {answer && answer.sources.length > 0 ? (
              <div {...stylex.props(styles.sources)}>
                {answer.sources.map((s) => (
                  <SourceRow key={s.itemId} itemId={s.itemId} why={s.why} onOpen={onOpenItem} />
                ))}
              </div>
            ) : null}
            {answer && !undone ? (
              <div {...stylex.props(styles.proposals)}>
                <ProposalList
                  runId={entry.id}
                  proposals={answer.proposals ?? []}
                  appliedCount={answer.appliedCount ?? 0}
                  undoable={undoable}
                />
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  )
}

/**
 * "Activity": the agent runs that touched an item, live ones from the runs store
 * merged with the persisted summaries from `items:get`. Steps are shown in product voice.
 */
export function AgentActivity({
  itemId,
  latestRuns,
  onOpenItem
}: {
  itemId: string
  latestRuns: AgentRunSummary[]
  onOpenItem: (id: string) => void
}): React.JSX.Element {
  const live = useRuns(
    useShallow((s) =>
      s.order.map((id) => s.runs[id]).filter((r): r is RunState => r !== undefined && r.itemId === itemId)
    )
  )

  const entries = useMemo<Entry[]>(() => {
    const byId = new Map<string, Entry>()
    for (const r of latestRuns) byId.set(r.id, { id: r.id, startedAt: Date.parse(r.startedAt), summary: r })
    for (const r of live)
      byId.set(r.runId, {
        ...byId.get(r.runId),
        id: r.runId,
        startedAt: byId.get(r.runId)?.startedAt ?? r.startedAt,
        live: r
      })
    return [...byId.values()].sort((a, b) => b.startedAt - a.startedAt)
  }, [latestRuns, live])

  if (entries.length === 0)
    return <p {...stylex.props(styles.empty)}>Nothing yet. Runs show up here as the agent works on this.</p>
  return (
    <div {...stylex.props(styles.list)}>
      {entries.map((e) => (
        <ActivityEntry key={e.id} entry={e} onOpenItem={onOpenItem} />
      ))}
    </div>
  )
}
