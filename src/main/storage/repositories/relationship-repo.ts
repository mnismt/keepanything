import type { Relationship, RelationshipEvidence, RelationshipType } from '../../../shared/types'
import type { Db } from '../db'
import { parseJson, type Row, requireText, text } from './rows'

export function rowToRelationship(row: Row): Relationship {
  return {
    id: requireText(row.id, 'id'),
    sourceItemId: requireText(row.source_item_id, 'source_item_id'),
    targetItemId: requireText(row.target_item_id, 'target_item_id'),
    type: requireText(row.type, 'type') as RelationshipType,
    description: text(row.description),
    confidence: typeof row.confidence === 'number' ? row.confidence : null,
    evidence: parseJson<RelationshipEvidence | null>(row.evidence, null),
    createdBy: requireText(row.created_by, 'created_by') as Relationship['createdBy'],
    agentRunId: text(row.agent_run_id),
    createdAt: requireText(row.created_at, 'created_at')
  }
}

/** Relationship repository. Pair normalization happens in the service. */
export interface RelationshipRepo {
  insert(relationship: Relationship): void
  get(id: string): Relationship | null
  delete(id: string): void
  /** Edges touching `itemId` in either direction (other side may be trashed; callers filter). */
  forItem(itemId: string): Relationship[]
  /** Exact stored triple. */
  find(sourceItemId: string, targetItemId: string, type: RelationshipType): Relationship | null
  /** Any edge between two items regardless of direction/type. */
  between(a: string, b: string): Relationship[]
  count(): number
}

export function createRelationshipRepo(db: Db): RelationshipRepo {
  return {
    insert(r) {
      db.prepare(
        `INSERT INTO relationships (id, source_item_id, target_item_id, type, description, confidence, evidence, created_by, agent_run_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        r.id,
        r.sourceItemId,
        r.targetItemId,
        r.type,
        r.description,
        r.confidence,
        r.evidence ? JSON.stringify(r.evidence) : null,
        r.createdBy,
        r.agentRunId,
        r.createdAt
      )
    },
    get(id) {
      const row = db.prepare('SELECT * FROM relationships WHERE id = ?').get(id) as Row | undefined
      return row ? rowToRelationship(row) : null
    },
    delete(id) {
      db.prepare('DELETE FROM relationships WHERE id = ?').run(id)
    },
    forItem(itemId) {
      return (
        db
          .prepare(
            'SELECT * FROM relationships WHERE source_item_id = ? OR target_item_id = ? ORDER BY created_at DESC'
          )
          .all(itemId, itemId) as Row[]
      ).map(rowToRelationship)
    },
    find(sourceItemId, targetItemId, type) {
      const row = db
        .prepare('SELECT * FROM relationships WHERE source_item_id = ? AND target_item_id = ? AND type = ?')
        .get(sourceItemId, targetItemId, type) as Row | undefined
      return row ? rowToRelationship(row) : null
    },
    between(a, b) {
      return (
        db
          .prepare(
            `SELECT * FROM relationships WHERE (source_item_id = ? AND target_item_id = ?) OR (source_item_id = ? AND target_item_id = ?)`
          )
          .all(a, b, b, a) as Row[]
      ).map(rowToRelationship)
    },
    count() {
      return Number((db.prepare('SELECT count(*) AS n FROM relationships').get() as Row).n ?? 0)
    }
  }
}
