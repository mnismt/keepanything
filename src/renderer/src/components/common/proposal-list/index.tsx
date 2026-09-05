import * as stylex from '@stylexjs/stylex'
import { useEffect, useState } from 'react'
import type { AgentProposal } from '../../../../../shared/types'
import { applyProposals, undoRun } from '../../../lib/agent-actions'
import { count } from '../../../lib/format'
import { shared } from '../../../styles/shared'
import { Button } from '../button'
import { styles } from './styles'

export interface ProposalListProps {
  runId: string
  /** Staged, not yet applied. */
  proposals: readonly AgentProposal[]
  /** Changes the run already applied on its own (item actions). */
  appliedCount?: number
  /** The run has audited changes that can still be undone. */
  undoable?: boolean
}

/**
 * Staged agent changes with one Apply button, and the "Applied N changes · Undo" line for runs that
 * already wrote something. Renders nothing when there is neither.
 */
export function ProposalList({
  runId,
  proposals,
  appliedCount = 0,
  undoable = false
}: ProposalListProps): React.JSX.Element | null {
  const [remaining, setRemaining] = useState<readonly AgentProposal[]>(proposals)
  const [applied, setApplied] = useState(appliedCount)
  const [canUndo, setCanUndo] = useState(undoable)
  const [busy, setBusy] = useState(false)

  useEffect(() => setRemaining(proposals), [proposals])
  useEffect(() => setApplied(appliedCount), [appliedCount])
  useEffect(() => setCanUndo(undoable), [undoable])

  if (remaining.length === 0 && applied === 0) return null

  const apply = async (): Promise<void> => {
    setBusy(true)
    const r = await applyProposals(runId)
    setBusy(false)
    if (!r) return
    setRemaining(r.remaining)
    setApplied((n) => n + r.applied)
    if (r.applied > 0) setCanUndo(true)
  }

  const undo = async (): Promise<void> => {
    setBusy(true)
    const ok = await undoRun(runId)
    setBusy(false)
    if (ok) setCanUndo(false)
  }

  return (
    <section {...stylex.props(styles.box)} aria-label="Proposed changes">
      {remaining.length > 0 ? (
        <>
          <span {...stylex.props(shared.eyebrow)}>Proposed, not applied</span>
          <ul {...stylex.props(styles.list)}>
            {remaining.map((p) => (
              <li key={`${p.kind}:${p.label}`} {...stylex.props(styles.item)}>
                <span {...stylex.props(styles.bullet)} aria-hidden="true">
                  ·
                </span>
                <span>{p.label}</span>
                <span {...stylex.props(styles.confidence)} title="Confidence">
                  {Math.round(p.confidence * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <div {...stylex.props(styles.foot)}>
        <span {...stylex.props(styles.applied)}>
          {applied > 0 ? `Applied ${count(applied, 'change')}.` : 'Nothing is changed until you apply.'}
        </span>
        {applied > 0 && canUndo ? (
          <Button small variant="quiet" onClick={() => void undo()} disabled={busy}>
            Undo
          </Button>
        ) : null}
        {remaining.length > 0 ? (
          <Button small onClick={() => void apply()} disabled={busy}>
            {busy ? 'Applying…' : remaining.length === 1 ? 'Apply' : `Apply ${remaining.length}`}
          </Button>
        ) : null}
      </div>
    </section>
  )
}
