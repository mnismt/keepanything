import type { AuditEntry } from '../../../shared/types'
import type { Db } from '../db'
import { parseJson, type Row, requireText, text } from './rows'

export function rowToAudit(row: Row): AuditEntry {
  return {
    id: requireText(row.id, 'id'),
    actor: requireText(row.actor, 'actor') as AuditEntry['actor'],
    action: requireText(row.action, 'action'),
    entity: requireText(row.entity, 'entity'),
    entityId: requireText(row.entity_id, 'entity_id'),
    before: parseJson<unknown>(row.before, null),
    after: parseJson<unknown>(row.after, null),
    agentRunId: text(row.agent_run_id),
    createdAt: requireText(row.created_at, 'created_at'),
    undoneAt: text(row.undone_at)
  }
}

export interface AuditRepo {
  insert(entry: AuditEntry): void
  get(id: string): AuditEntry | null
  markUndone(id: string, undoneAt: string): void
  forRun(agentRunId: string): AuditEntry[]
  forEntity(entity: string, entityId: string): AuditEntry[]
  latest(limit: number): AuditEntry[]
}

export function createAuditRepo(db: Db): AuditRepo {
  return {
    insert(e) {
      db.prepare(
        `INSERT INTO audit_log (id, actor, action, entity, entity_id, before, after, agent_run_id, created_at, undone_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        e.id,
        e.actor,
        e.action,
        e.entity,
        e.entityId,
        e.before === null || e.before === undefined ? null : JSON.stringify(e.before),
        e.after === null || e.after === undefined ? null : JSON.stringify(e.after),
        e.agentRunId,
        e.createdAt,
        e.undoneAt
      )
    },
    get(id) {
      const row = db.prepare('SELECT * FROM audit_log WHERE id = ?').get(id) as Row | undefined
      return row ? rowToAudit(row) : null
    },
    markUndone(id, undoneAt) {
      db.prepare('UPDATE audit_log SET undone_at = ? WHERE id = ?').run(undoneAt, id)
    },
    forRun(agentRunId) {
      return (
        db.prepare('SELECT * FROM audit_log WHERE agent_run_id = ? ORDER BY created_at, rowid').all(agentRunId) as Row[]
      ).map(rowToAudit)
    },
    forEntity(entity, entityId) {
      return (
        db
          .prepare('SELECT * FROM audit_log WHERE entity = ? AND entity_id = ? ORDER BY created_at DESC, rowid DESC')
          .all(entity, entityId) as Row[]
      ).map(rowToAudit)
    },
    latest(limit) {
      return (
        db
          .prepare('SELECT * FROM audit_log ORDER BY created_at DESC, rowid DESC LIMIT ?')
          .all(Math.max(1, limit)) as Row[]
      ).map(rowToAudit)
    }
  }
}
