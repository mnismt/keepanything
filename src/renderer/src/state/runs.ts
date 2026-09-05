/**
 * Agent runs keyed by runId. Subscribed ONCE at boot. The `running` event arrives BEFORE the
 * `agent:command` invoke resolves, so `applyEvent` must accept unknown run ids and create the
 * entry on the fly; the invoke result only tells the caller which id to watch.
 * Pure (no DOM) so the reducer is unit-testable under node.
 */
import { create } from 'zustand'
import type { AgentRunEvent, IpcError } from '../../../shared/ipc'
import type { AgentResult, AgentRunStatus, AgentStep, AgentTask } from '../../../shared/types'

export interface RunState {
  runId: string
  task: AgentTask
  status: AgentRunStatus
  itemId: string | null
  batchId: string | null
  steps: AgentStep[]
  result: AgentResult | null
  error: IpcError | null
  /** The run wrote audited changes that can be reverted with `agent:undoRun`. */
  undoable: boolean
  startedAt: number
  endedAt: number | null
}

export interface RunsState {
  runs: Record<string, RunState>
  /** Insertion order, oldest first. */
  order: string[]
  applyEvent: (event: AgentRunEvent, now?: number) => void
  forget: (runId: string) => void
  /** Flip `undoable` after `agent:undoRun` so Undo controls disappear. */
  markUndone: (runId: string) => void
  /** Drop terminal runs older than `maxAgeMs` (keeps the stack tidy). */
  prune: (maxAgeMs: number, now?: number) => void
}

export function isTerminalRun(status: AgentRunStatus): boolean {
  return status !== 'running'
}

/** Pure reducer: fold one event into the run map. */
export function reduceRunEvent(
  runs: Record<string, RunState>,
  order: string[],
  event: AgentRunEvent,
  now: number
): { runs: Record<string, RunState>; order: string[] } {
  const existing = runs[event.runId]
  const base: RunState = existing ?? {
    runId: event.runId,
    task: event.task,
    status: 'running',
    itemId: event.itemId ?? null,
    batchId: event.batchId ?? null,
    steps: [],
    result: null,
    error: null,
    undoable: false,
    startedAt: now,
    endedAt: null
  }
  const steps = event.step && !base.steps.some((s) => s.n === event.step?.n) ? [...base.steps, event.step] : base.steps
  const terminal = isTerminalRun(event.status)
  const next: RunState = {
    ...base,
    task: event.task,
    status: event.status,
    itemId: event.itemId ?? base.itemId,
    batchId: event.batchId ?? base.batchId,
    steps,
    result: event.result ?? base.result,
    error: event.error ?? (terminal && event.status !== 'succeeded' ? base.error : base.error),
    undoable: event.undoable ?? base.undoable,
    endedAt: terminal ? (base.endedAt ?? now) : null
  }
  return {
    runs: { ...runs, [event.runId]: next },
    order: existing ? order : [...order, event.runId]
  }
}

export const useRuns = create<RunsState>((set, get) => ({
  runs: {},
  order: [],

  applyEvent(event, now = Date.now()) {
    const { runs, order } = get()
    set(reduceRunEvent(runs, order, event, now))
  },

  forget(runId) {
    set((s) => {
      const runs = { ...s.runs }
      delete runs[runId]
      return { runs, order: s.order.filter((id) => id !== runId) }
    })
  },

  markUndone(runId) {
    set((s) => {
      const run = s.runs[runId]
      if (!run || !run.undoable) return s
      return { runs: { ...s.runs, [runId]: { ...run, undoable: false } } }
    })
  },

  prune(maxAgeMs, now = Date.now()) {
    set((s) => {
      const runs = { ...s.runs }
      const order = s.order.filter((id) => {
        const run = runs[id]
        if (!run) return false
        if (run.endedAt !== null && now - run.endedAt > maxAgeMs) {
          delete runs[id]
          return false
        }
        return true
      })
      return { runs, order }
    })
  }
}))

/** Runs still in flight, oldest first. */
export function selectActiveRuns(s: RunsState): RunState[] {
  return s.order.map((id) => s.runs[id]).filter((r): r is RunState => r !== undefined && r.status === 'running')
}

/** The last few finished runs for the status stack. */
export function selectRecentFinished(s: RunsState, limit = 3): RunState[] {
  return s.order
    .map((id) => s.runs[id])
    .filter((r): r is RunState => r !== undefined && r.status !== 'running')
    .slice(-limit)
}
