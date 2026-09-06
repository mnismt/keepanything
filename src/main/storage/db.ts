import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite'
import INIT_SQL from './migrations/001-init.sql?raw'
import ONE_SHAPE_SQL from './migrations/002-one-collection-shape.sql?raw'

/**
 * Thin wrapper over `node:sqlite` `DatabaseSync`: PRAGMAs, versioned migrations and a nesting
 * `transaction()` helper (BEGIN IMMEDIATE at depth 0, SAVEPOINT below). Synchronous by design:
 * never `await` inside `transaction(fn)`; the helper throws if `fn` returns a promise.
 */
export interface Db {
  readonly raw: DatabaseSync
  /** Prepared statement cached by SQL text. */
  prepare(sql: string): StatementSync
  /** Run `fn` atomically. Nested calls become savepoints. Rethrows after rolling back. */
  transaction<T>(fn: () => T): T
  /** True while inside `transaction()`. */
  inTransaction(): boolean
  /**
   * Run `fn` once the outermost transaction commits (immediately when not in one). Discarded on
   * rollback. Services use it to emit events only for state that actually exists.
   */
  afterCommit(fn: () => void): void
  /** Apply pending migrations from `MIGRATIONS`. */
  migrate(): void
  /** Highest applied migration version (0 when none). */
  schemaVersion(): number
  close(): void
}

/** One schema migration. `sql` may contain many statements. */
export interface Migration {
  version: number
  name: string
  sql: string
}

/** Every migration, ascending. New ones are appended here and as `migrations/NNN_name.sql`. */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: '001-init', sql: INIT_SQL },
  { version: 2, name: '002-one-collection-shape', sql: ONE_SHAPE_SQL }
]

export interface OpenDatabaseOptions {
  /** Milliseconds to wait on a locked database (default 5000). */
  busyTimeoutMs?: number
}

/** Open (creating if needed) the library database with the production PRAGMAs. Does not migrate. */
export function openDatabase(file: string, options: OpenDatabaseOptions = {}): Db {
  const raw = new DatabaseSync(file)
  if (file !== ':memory:') raw.exec('PRAGMA journal_mode = WAL')
  raw.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.floor(options.busyTimeoutMs ?? 5000))}`)
  raw.exec('PRAGMA foreign_keys = ON')
  raw.exec('PRAGMA synchronous = NORMAL')
  raw.exec('PRAGMA temp_store = MEMORY')

  const statements = new Map<string, StatementSync>()
  let depth = 0
  let deferred: (() => void)[] = []

  const flushDeferred = (): void => {
    const callbacks = deferred
    deferred = []
    for (const fn of callbacks) fn()
  }

  const prepare = (sql: string): StatementSync => {
    let stmt = statements.get(sql)
    if (!stmt) {
      stmt = raw.prepare(sql)
      statements.set(sql, stmt)
    }
    return stmt
  }

  const transaction = <T>(fn: () => T): T => {
    const level = depth
    const savepoint = `ka_sp_${level}`
    if (level === 0) raw.exec('BEGIN IMMEDIATE')
    else raw.exec(`SAVEPOINT ${savepoint}`)
    depth += 1
    let result: T
    try {
      result = fn()
      if (result instanceof Promise) {
        throw new Error('db.transaction(fn): fn must be synchronous (no await inside a transaction)')
      }
    } catch (error) {
      depth -= 1
      if (level === 0) {
        raw.exec('ROLLBACK')
        deferred = []
      } else {
        raw.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`)
      }
      throw error
    }
    depth -= 1
    if (level === 0) {
      raw.exec('COMMIT')
      flushDeferred()
    } else {
      raw.exec(`RELEASE ${savepoint}`)
    }
    return result
  }

  const afterCommit = (fn: () => void): void => {
    if (depth === 0) fn()
    else deferred.push(fn)
  }

  const schemaVersion = (): number => {
    const exists = raw
      .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
      .get()
    if (!exists) return 0
    const row = raw.prepare('SELECT coalesce(max(version), 0) AS v FROM schema_migrations').get() as { v: number }
    return row.v
  }

  const migrate = (): void => {
    raw.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)')
    const applied = schemaVersion()
    for (const migration of MIGRATIONS) {
      if (migration.version <= applied) continue
      transaction(() => {
        raw.exec(migration.sql)
        raw
          .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
          .run(migration.version, new Date().toISOString())
      })
    }
  }

  return {
    raw,
    prepare,
    transaction,
    inTransaction: () => depth > 0,
    afterCommit,
    migrate,
    schemaVersion,
    close: () => {
      statements.clear()
      raw.close()
    }
  }
}

export type SqlValue = SQLInputValue

/** Coerce JS values to SQLite parameters: booleans -> 0/1, undefined -> null, objects -> JSON. */
export function toSql(value: unknown): SqlValue {
  if (value === undefined || value === null) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'bigint') return value
  if (value instanceof Uint8Array) return value
  return JSON.stringify(value)
}
