import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { type Db, MIGRATIONS, openDatabase, toSql } from '../../src/main/storage/db'

const dirs: string[] = []
const dbs: Db[] = []

afterEach(() => {
  for (const db of dbs.splice(0)) {
    try {
      db.close()
    } catch {
      // already closed
    }
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ka-db-'))
  dirs.push(dir)
  return join(dir, 'library.db')
}

function open(file = ':memory:'): Db {
  const db = openDatabase(file)
  dbs.push(db)
  return db
}

describe('openDatabase + migrate', () => {
  it('creates the file, applies migrations once and records the version', () => {
    const file = tempFile()
    const db = open(file)
    expect(db.schemaVersion()).toBe(0)
    db.migrate()
    expect(existsSync(file)).toBe(true)
    expect(db.schemaVersion()).toBe(MIGRATIONS.length)
    const tables = db.raw
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table') ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name)
    expect(tables).toEqual(expect.arrayContaining(['items', 'items_fts', 'jobs', 'collections', 'schema_migrations']))
    expect(() => db.migrate()).not.toThrow()
    expect(db.raw.prepare('SELECT count(*) AS n FROM schema_migrations').get()).toEqual({ n: MIGRATIONS.length })
  })

  it('uses WAL, foreign keys and a busy timeout', () => {
    const db = open(tempFile())
    expect(db.raw.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' })
    expect(db.raw.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
    expect((db.raw.prepare('PRAGMA busy_timeout').get() as { timeout: number }).timeout).toBe(5000)
  })
})

describe('transaction()', () => {
  it('commits on success and rolls back everything on a throw', () => {
    const db = open()
    db.migrate()
    db.transaction(() => {
      db.prepare("INSERT INTO suppressions (kind, key, created_at) VALUES ('relationship', 'a:b', 'now')").run()
    })
    expect(() =>
      db.transaction(() => {
        db.prepare("INSERT INTO suppressions (kind, key, created_at) VALUES ('relationship', 'c:d', 'now')").run()
        throw new Error('boom')
      })
    ).toThrow('boom')
    expect(db.raw.prepare('SELECT count(*) AS n FROM suppressions').get()).toEqual({ n: 1 })
    expect(db.inTransaction()).toBe(false)
  })

  it('nests as savepoints: an inner failure can be caught without losing the outer work', () => {
    const db = open()
    db.migrate()
    db.transaction(() => {
      db.prepare("INSERT INTO suppressions (kind, key, created_at) VALUES ('relationship', 'outer', 'now')").run()
      expect(db.inTransaction()).toBe(true)
      try {
        db.transaction(() => {
          db.prepare("INSERT INTO suppressions (kind, key, created_at) VALUES ('relationship', 'inner', 'now')").run()
          throw new Error('inner')
        })
      } catch {
        // swallowed
      }
      expect(db.inTransaction()).toBe(true)
    })
    const keys = db.raw
      .prepare('SELECT key FROM suppressions ORDER BY key')
      .all()
      .map((r) => (r as { key: string }).key)
    expect(keys).toEqual(['outer'])
  })

  it('refuses async bodies', () => {
    const db = open()
    expect(() => db.transaction(async () => 1)).toThrow(/synchronous/)
    expect(db.inTransaction()).toBe(false)
  })

  it('runs afterCommit callbacks only after the outermost commit, never after a rollback', () => {
    const db = open()
    db.migrate()
    const log: string[] = []
    db.transaction(() => {
      db.transaction(() => {
        db.afterCommit(() => log.push('inner'))
      })
      expect(log).toEqual([])
      db.afterCommit(() => log.push('outer'))
    })
    expect(log).toEqual(['inner', 'outer'])
    expect(() =>
      db.transaction(() => {
        db.afterCommit(() => log.push('lost'))
        throw new Error('x')
      })
    ).toThrow()
    expect(log).toEqual(['inner', 'outer'])
    db.afterCommit(() => log.push('immediate'))
    expect(log).toContain('immediate')
  })
})

describe('toSql', () => {
  it('coerces JS values to SQLite parameters', () => {
    expect(toSql(undefined)).toBeNull()
    expect(toSql(true)).toBe(1)
    expect(toSql(false)).toBe(0)
    expect(toSql({ a: 1 })).toBe('{"a":1}')
    expect(toSql('x')).toBe('x')
  })
})
