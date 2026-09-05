import type { AgentResult, AgentRunDetail, AgentRunSummary, AgentStep, AgentUsage } from '../../../shared/types'
import type { Db } from '../db'
import { parseJson, type Row, requireText, text } from './rows'

/**
 * `SELECT` list for run queries: the row plus `undoable` (an audited change of the run that has not
 * been undone), so summaries can offer Undo without a second query per run.
 */
const RUN_COLUMNS = `agent_runs.*, EXISTS (
  SELECT 1 FROM audit_log WHERE audit_log.agent_run_id = agent_runs.id AND audit_log.undone_at IS NULL
) AS undoable`

/** Map an `agent_runs` row to the full detail (steps parsed). */
export function rowToRunDetail(row: Row): AgentRunDetail {
  const steps = parseJson<AgentStep[]>(row.steps, [])
  return {
    id: requireText(row.id, 'id'),
    itemId: text(row.item_id),
    batchId: text(row.batch_id),
    task: requireText(row.task, 'task') as AgentRunDetail['task'],
    status: requireText(row.status, 'status') as AgentRunDetail['status'],
    model: requireText(row.model, 'model'),
    startedAt: requireText(row.started_at, 'started_at'),
    completedAt: text(row.completed_at),
    stepCount: Array.isArray(steps) ? steps.length : 0,
    error: text(row.error),
    steps: Array.isArray(steps) ? steps : [],
    undoable: Number(row.undoable ?? 0) === 1,
    usage: parseJson<AgentUsage | null>(row.usage, null),
    result: parseJson<AgentResult | null>(row.result, null)
  }
}

/** Strip result and usage for list payloads (steps stay: the activity panel renders them). */
export function toRunSummary(detail: AgentRunDetail): AgentRunSummary {
  const { usage: _usage, result: _result, ...summary } = detail
  return summary
}

/** Fields updatable while a run progresses. */
export interface AgentRunUpdate {
  status?: AgentRunDetail['status']
  completedAt?: string | null
  steps?: AgentStep[]
  result?: AgentResult | null
  error?: string | null
  usage?: AgentUsage | null
}

/** Agent run repository (transcripts without reasoning). */
export interface AgentRunRepo {
  insert(run: AgentRunDetail): void
  update(id: string, patch: AgentRunUpdate): void
  get(id: string): AgentRunDetail | null
  latestForItem(itemId: string, limit: number): AgentRunSummary[]
  forBatch(batchId: string): AgentRunSummary[]
  /** Runs still marked `running` (crash recovery at boot). */
  running(): AgentRunDetail[]
}

export function createAgentRunRepo(db: Db): AgentRunRepo {
  return {
    insert(run) {
      db.prepare(
        `INSERT INTO agent_runs (id, item_id, batch_id, task, status, model, started_at, completed_at, steps, result, error, usage)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        run.id,
        run.itemId,
        run.batchId,
        run.task,
        run.status,
        run.model,
        run.startedAt,
        run.completedAt,
        JSON.stringify(run.steps),
        run.result ? JSON.stringify(run.result) : null,
        run.error,
        run.usage ? JSON.stringify(run.usage) : null
      )
    },
    update(id, patch) {
      const sets: string[] = []
      const params: (string | null)[] = []
      if (patch.status !== undefined) sets.push('status = ?'), params.push(patch.status)
      if (patch.completedAt !== undefined) sets.push('completed_at = ?'), params.push(patch.completedAt)
      if (patch.steps !== undefined) sets.push('steps = ?'), params.push(JSON.stringify(patch.steps))
      if (patch.result !== undefined)
        sets.push('result = ?'), params.push(patch.result ? JSON.stringify(patch.result) : null)
      if (patch.error !== undefined) sets.push('error = ?'), params.push(patch.error)
      if (patch.usage !== undefined)
        sets.push('usage = ?'), params.push(patch.usage ? JSON.stringify(patch.usage) : null)
      if (sets.length === 0) return
      db.prepare(`UPDATE agent_runs SET ${sets.join(', ')} WHERE id = ?`).run(...params, id)
    },
    get(id) {
      const row = db.prepare(`SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ?`).get(id) as Row | undefined
      return row ? rowToRunDetail(row) : null
    },
    latestForItem(itemId, limit) {
      return (
        db
          .prepare(
            `SELECT ${RUN_COLUMNS} FROM agent_runs
             WHERE item_id = ? OR batch_id IN (SELECT capture_batch_id FROM items WHERE id = ? AND capture_batch_id IS NOT NULL)
             ORDER BY started_at DESC LIMIT ?`
          )
          .all(itemId, itemId, Math.max(1, limit)) as Row[]
      ).map((r) => toRunSummary(rowToRunDetail(r)))
    },
    forBatch(batchId) {
      return (
        db
          .prepare(`SELECT ${RUN_COLUMNS} FROM agent_runs WHERE batch_id = ? ORDER BY started_at DESC`)
          .all(batchId) as Row[]
      ).map((r) => toRunSummary(rowToRunDetail(r)))
    },
    running() {
      return (db.prepare(`SELECT ${RUN_COLUMNS} FROM agent_runs WHERE status = 'running'`).all() as Row[]).map(
        rowToRunDetail
      )
    }
  }
}
