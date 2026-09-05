import { describe, expect, it } from 'vitest'
import {
  type RunState,
  reduceRunEvent,
  selectActiveRuns,
  selectRecentFinished,
  useRuns
} from '../../src/renderer/src/state/runs'
import type { AgentRunEvent } from '../../src/shared/ipc'

const running: AgentRunEvent = { runId: 'r1', task: 'command', status: 'running' }
const step = (n: number): AgentRunEvent => ({
  runId: 'r1',
  task: 'command',
  status: 'running',
  step: { n, tool: 'search_library', kind: 'search', label: `Step ${n}`, status: 'ok', durationMs: 10 }
})
const done: AgentRunEvent = {
  runId: 'r1',
  task: 'command',
  status: 'succeeded',
  result: {
    task: 'command',
    kind: 'answer',
    answer: 'Yes.',
    sources: [],
    cues: { topics: [], types: [] },
    confidence: 0.7
  }
}

describe('runs reducer', () => {
  it('creates an entry for an unknown run id (event arrives before the invoke resolves)', () => {
    const { runs, order } = reduceRunEvent({}, [], step(1), 1000)
    expect(order).toEqual(['r1'])
    expect(runs.r1).toMatchObject({ runId: 'r1', task: 'command', status: 'running', startedAt: 1000, endedAt: null })
    expect(runs.r1?.steps).toHaveLength(1)
  })

  it('appends steps in order and ignores a re-delivered step', () => {
    let state = reduceRunEvent({}, [], running, 0)
    state = reduceRunEvent(state.runs, state.order, step(1), 1)
    state = reduceRunEvent(state.runs, state.order, step(2), 2)
    state = reduceRunEvent(state.runs, state.order, step(2), 3)
    expect(state.runs.r1?.steps.map((s) => s.n)).toEqual([1, 2])
    expect(state.order).toEqual(['r1'])
  })

  it('terminal events set status, result and endedAt, and keep the steps', () => {
    let state = reduceRunEvent({}, [], step(1), 5)
    state = reduceRunEvent(state.runs, state.order, done, 9)
    const run = state.runs.r1 as RunState
    expect(run.status).toBe('succeeded')
    expect(run.result?.task).toBe('command')
    expect(run.endedAt).toBe(9)
    expect(run.steps).toHaveLength(1)
  })

  it('carries undoable from the terminal event and clears it on markUndone', () => {
    let state = reduceRunEvent({}, [], running, 0)
    expect(state.runs.r1?.undoable).toBe(false)
    state = reduceRunEvent(state.runs, state.order, { ...done, undoable: true }, 1)
    expect(state.runs.r1?.undoable).toBe(true)
    useRuns.setState({ runs: state.runs, order: state.order })
    useRuns.getState().markUndone('r1')
    expect(useRuns.getState().runs.r1?.undoable).toBe(false)
    useRuns.getState().markUndone('nope')
    expect(useRuns.getState().order).toEqual(['r1'])
  })

  it('a terminal event for an unknown id still records the run', () => {
    const failed: AgentRunEvent = {
      runId: 'r9',
      task: 'organize',
      status: 'failed',
      itemId: 'it-1',
      error: { code: 'AI_UNAVAILABLE', message: 'offline' }
    }
    const { runs } = reduceRunEvent({}, [], failed, 42)
    expect(runs.r9).toMatchObject({ status: 'failed', itemId: 'it-1', endedAt: 42, error: { code: 'AI_UNAVAILABLE' } })
  })
})

describe('runs store', () => {
  it('applyEvent + selectors + prune', () => {
    const store = useRuns
    store.setState({ runs: {}, order: [] })
    store.getState().applyEvent(running, 100)
    store.getState().applyEvent({ runId: 'r2', task: 'organize', status: 'running' }, 101)
    expect(selectActiveRuns(store.getState()).map((r) => r.runId)).toEqual(['r1', 'r2'])
    store.getState().applyEvent(done, 200)
    expect(selectActiveRuns(store.getState()).map((r) => r.runId)).toEqual(['r2'])
    expect(selectRecentFinished(store.getState()).map((r) => r.runId)).toEqual(['r1'])
    store.getState().prune(1000, 5000)
    expect(store.getState().runs.r1).toBeUndefined()
    expect(store.getState().runs.r2).toBeDefined()
    store.getState().forget('r2')
    expect(store.getState().order).toEqual([])
  })
})
