import type { SuppressionKind } from '../../../shared/types'
import type { Db } from '../db'
import type { Row } from './rows'

/** Facts the agent must not re-create after a user removed them. */
export interface SuppressionRepo {
  /** Idempotent insert. */
  add(kind: SuppressionKind, key: string, nowIso: string): void
  has(kind: SuppressionKind, key: string): boolean
  remove(kind: SuppressionKind, key: string): void
  /** Every key of one kind (agent tool handlers filter candidates in bulk). */
  keys(kind: SuppressionKind): Set<string>
}

export function createSuppressionRepo(db: Db): SuppressionRepo {
  return {
    add(kind, key, nowIso) {
      db.prepare('INSERT OR IGNORE INTO suppressions (kind, key, created_at) VALUES (?, ?, ?)').run(kind, key, nowIso)
    },
    has(kind, key) {
      return db.prepare('SELECT 1 AS ok FROM suppressions WHERE kind = ? AND key = ?').get(kind, key) !== undefined
    },
    remove(kind, key) {
      db.prepare('DELETE FROM suppressions WHERE kind = ? AND key = ?').run(kind, key)
    },
    keys(kind) {
      return new Set(
        (db.prepare('SELECT key FROM suppressions WHERE kind = ?').all(kind) as Row[]).map((r) => String(r.key))
      )
    }
  }
}
