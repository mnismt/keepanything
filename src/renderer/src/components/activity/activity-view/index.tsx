import * as stylex from '@stylexjs/stylex'
import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { STAGE_LABEL } from '../../../../../shared/status'
import type { AgentRunSummary, JobProgress } from '../../../../../shared/types'
import { invoke } from '../../../lib/ipc-client'
import { useJobs } from '../../../state/jobs'
import { useLibrary } from '../../../state/library'
import { useRuns } from '../../../state/runs'
import { useUi } from '../../../state/ui'
import { shared } from '../../../styles/shared'
import { Dot } from '../../common'
import { AgentActivity } from '../../detail'
import { styles } from './styles'

function JobRow({ job }: { job: JobProgress }): React.JSX.Element {
  const title = useLibrary((s) => (job.itemId ? s.byId[job.itemId]?.title : undefined))
  const failed = job.jobStatus === 'failed'
  const retry = async (): Promise<void> => {
    if (job.itemId) await useLibrary.getState().reprocess(job.itemId)
  }
  return (
    <div {...stylex.props(styles.job)}>
      <Dot tone={failed ? 'failed' : 'processing'} />
      <span {...stylex.props(styles.jobTitle, shared.ellipsis)}>{title ?? 'An item'}</span>
      <span {...stylex.props(styles.jobStage)} title={job.message}>
        {failed ? "Couldn't finish" : job.jobStatus === 'queued' ? 'Waiting' : STAGE_LABEL[job.stage]}
      </span>
      {failed && job.itemId ? (
        <button type="button" {...stylex.props(shared.hoverFade, styles.retry)} onClick={() => void retry()}>
          Retry
        </button>
      ) : null}
    </div>
  )
}

/**
 * The Activity section: items the pipeline is working on right now, then every agent run
 * (live and past) newest first. Past runs reload whenever a live run finishes.
 */
export function ActivityView(): React.JSX.Element {
  const jobs = useJobs(useShallow((s) => Object.values(s.byItem)))
  const openDetail = useUi((s) => s.openDetail)
  const [past, setPast] = useState<AgentRunSummary[]>([])

  // Load once, then again each time a live run settles so the persisted row replaces the live one.
  useEffect(() => {
    let cancelled = false
    const load = (): void => {
      void invoke('agent:runs', {}).then((r) => {
        if (!cancelled && r.ok) setPast(r.data)
      })
    }
    load()
    let settled = Object.values(useRuns.getState().runs).filter((r) => r.status !== 'running').length
    const off = useRuns.subscribe((s) => {
      const now = Object.values(s.runs).filter((r) => r.status !== 'running').length
      if (now === settled) return
      settled = now
      load()
    })
    return () => {
      cancelled = true
      off()
    }
  }, [])

  return (
    <div {...stylex.props(styles.view)}>
      {jobs.length > 0 ? (
        <section {...stylex.props(styles.section)}>
          <span {...stylex.props(shared.eyebrow)}>Working on</span>
          {jobs.map((j) => (
            <JobRow key={`${j.itemId}-${j.stage}`} job={j} />
          ))}
        </section>
      ) : null}
      <section {...stylex.props(styles.section)}>
        <span {...stylex.props(shared.eyebrow)}>Agent</span>
        <AgentActivity latestRuns={past} onOpenItem={(id) => openDetail(id, id)} />
      </section>
    </div>
  )
}
