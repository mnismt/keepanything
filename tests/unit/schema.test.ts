import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const SQL = readFileSync(
  fileURLToPath(new URL('../../src/main/storage/migrations/001-init.sql', import.meta.url)),
  'utf8'
)

const NOW = '2026-09-03T10:00:00.000Z'

function itemRow(id: string, title: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    type: 'url',
    subtype: 'article',
    kind: 'article',
    title,
    url: `https://example.com/${id}`,
    canonical_url: `https://example.com/${id}`,
    domain: 'example.com',
    created_at: NOW,
    captured_at: NOW,
    modified_at: NOW,
    last_kept_at: NOW,
    processing_status: 'CAPTURED',
    ...extra
  }
}

function insert(db: DatabaseSync, table: string, row: Record<string, unknown>): void {
  const cols = Object.keys(row)
  const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`
  const params: Record<string, string | number | null | Uint8Array> = {}
  for (const [k, v] of Object.entries(row)) {
    if (v === null || typeof v === 'string' || typeof v === 'number' || v instanceof Uint8Array) params[k] = v
    else params[k] = JSON.stringify(v)
  }
  db.prepare(sql).run(params)
}

describe('001-init.sql', () => {
  let db: DatabaseSync

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    db.exec(SQL)
  })

  afterEach(() => {
    db.close()
  })

  it('creates every table and the FTS index, and is idempotent', () => {
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name)
    for (const table of [
      'items',
      'items_fts',
      'collections',
      'collection_items',
      'relationships',
      'embeddings',
      'agent_runs',
      'jobs',
      'audit_log',
      'suppressions',
      'schema_migrations'
    ]) {
      expect(names).toContain(table)
    }
    expect(() => db.exec(SQL)).not.toThrow()
  })

  it('accepts one row in every table', () => {
    insert(db, 'schema_migrations', { version: 1, applied_at: NOW })
    insert(db, 'items', itemRow('folder-1', 'Research', { type: 'folder', subtype: null, kind: null, url: null }))
    insert(db, 'items', itemRow('item-1', 'Batching strategies for LLM inference', { parent_item_id: 'folder-1' }))
    insert(db, 'items', itemRow('item-2', 'A second article', { capture_batch_id: 'batch-1' }))
    insert(db, 'items_fts', {
      item_id: 'item-1',
      title: 'Batching strategies for LLM inference',
      retrieval_hints: 'gpu serving cost, continuous batching',
      topics: 'inference, gpu',
      entities: 'vLLM',
      understanding: 'Engineering article comparing inference batching strategies.',
      why_useful: 'Reference for reducing GPU serving cost.',
      vision_text: '',
      meta_text: 'example.com',
      extracted_text: 'Continuous batching keeps the GPU busy…',
      domain: 'example.com',
      kind: 'article'
    })
    insert(db, 'collections', {
      id: 'col-1',
      name: 'Local LLM inference research',
      name_key: 'local llm inference research',
      description: 'Notes and articles about running models locally and serving them cheaply.',
      created_by: 'agent',
      color: null,
      pinned: 0,
      created_at: NOW,
      updated_at: NOW
    })
    insert(db, 'collection_items', {
      collection_id: 'col-1',
      item_id: 'item-1',
      confidence: 0.82,
      reason: 'Compares inference batching strategies like the other members.',
      added_by: 'agent',
      agent_run_id: 'run-1',
      added_at: NOW
    })
    insert(db, 'relationships', {
      id: 'rel-1',
      source_item_id: 'item-1',
      target_item_id: 'item-2',
      type: 'related_to',
      description: 'Both discuss inference cost.',
      confidence: 0.7,
      evidence: { itemId: 'item-2', quote: 'inference cost' },
      created_by: 'agent',
      agent_run_id: 'run-1',
      created_at: NOW
    })
    const vector = new Float32Array([0.5, 0.5, 0.5, 0.5])
    insert(db, 'embeddings', {
      item_id: 'item-1',
      chunk_index: 0,
      role: 'summary',
      content: 'memory document',
      vector: new Uint8Array(vector.buffer),
      model: 'Xenova/all-MiniLM-L6-v2',
      dims: 4
    })
    insert(db, 'agent_runs', {
      id: 'run-1',
      item_id: 'item-1',
      batch_id: null,
      task: 'organize',
      status: 'succeeded',
      model: 'MiniMaxAI/MiniMax-M3',
      started_at: NOW,
      completed_at: NOW,
      steps: [{ n: 1, tool: 'finish', kind: 'finish', label: 'Done', status: 'ok', durationMs: 12 }],
      result: {
        task: 'organize',
        itemId: 'item-1',
        relationshipIds: ['rel-1'],
        collectionIds: ['col-1'],
        summary: 'ok'
      },
      error: null,
      usage: { promptTokens: 10, completionTokens: 5, calls: 1, latencyMs: 900 }
    })
    insert(db, 'jobs', {
      id: 'job-1',
      item_id: 'item-1',
      batch_id: null,
      stage: 'extract',
      lane: 'io',
      priority: 0,
      status: 'done',
      attempts: 1,
      run_after: null,
      last_error: null,
      created_at: NOW,
      updated_at: NOW
    })
    insert(db, 'audit_log', {
      id: 'audit-1',
      actor: 'agent',
      action: 'add_to_collection',
      entity: 'collection_item',
      entity_id: 'col-1:item-1',
      before: null,
      after: { collectionId: 'col-1', itemId: 'item-1' },
      agent_run_id: 'run-1',
      created_at: NOW,
      undone_at: null
    })
    insert(db, 'suppressions', { kind: 'relationship', key: 'item-1:item-2', created_at: NOW })

    const counts = db
      .prepare(
        `SELECT (SELECT count(*) FROM items) AS items, (SELECT count(*) FROM items_fts) AS fts,
                (SELECT count(*) FROM collections) AS collections, (SELECT count(*) FROM collection_items) AS members,
                (SELECT count(*) FROM relationships) AS rels, (SELECT count(*) FROM embeddings) AS embeddings,
                (SELECT count(*) FROM agent_runs) AS runs, (SELECT count(*) FROM jobs) AS jobs,
                (SELECT count(*) FROM audit_log) AS audit, (SELECT count(*) FROM suppressions) AS suppressions`
      )
      .get() as Record<string, number>
    expect(counts).toEqual({
      items: 3,
      fts: 1,
      collections: 1,
      members: 1,
      rels: 1,
      embeddings: 1,
      runs: 1,
      jobs: 1,
      audit: 1,
      suppressions: 1
    })

    // JSON1 works on the JSON columns and the BLOB round-trips as float32.
    const usage = db.prepare("SELECT json_extract(usage, '$.promptTokens') AS p FROM agent_runs").get() as { p: number }
    expect(usage.p).toBe(10)
    const blob = db.prepare('SELECT vector FROM embeddings').get() as { vector: Uint8Array }
    expect(Array.from(new Float32Array(blob.vector.buffer, blob.vector.byteOffset, 4))).toEqual([0.5, 0.5, 0.5, 0.5])
  })

  it('enforces closed vocabularies and foreign keys', () => {
    expect(() => insert(db, 'items', itemRow('bad', 'x', { type: 'bookmark' }))).toThrow(/CHECK/)
    expect(() => insert(db, 'items', itemRow('bad', 'x', { processing_status: 'DONE' }))).toThrow(/CHECK/)
    expect(() =>
      insert(db, 'collection_items', {
        collection_id: 'missing',
        item_id: 'missing',
        added_by: 'user',
        added_at: NOW
      })
    ).toThrow(/FOREIGN KEY/)
    // Deleting an item cascades to its memberships/relationships/embeddings/jobs.
    insert(db, 'items', itemRow('a', 'A'))
    insert(db, 'items', itemRow('b', 'B'))
    insert(db, 'relationships', {
      id: 'r',
      source_item_id: 'a',
      target_item_id: 'b',
      type: 'inspired_by',
      created_by: 'user',
      created_at: NOW
    })
    db.prepare('DELETE FROM items WHERE id = ?').run('a')
    expect((db.prepare('SELECT count(*) AS n FROM relationships').get() as { n: number }).n).toBe(0)
  })

  it('supports FTS MATCH with bm25 weights and prefix queries', () => {
    const rows = [
      { id: 'i1', title: 'Batching strategies for LLM inference', text: 'continuous batching on GPUs' },
      { id: 'i2', title: 'mnismt landing page', text: 'globe animation with warm typography' },
      { id: 'i3', title: 'Inference providers compared', text: 'cheap inference pricing table' }
    ]
    for (const r of rows) {
      insert(db, 'items_fts', {
        item_id: r.id,
        title: r.title,
        retrieval_hints: '',
        topics: '',
        entities: '',
        understanding: '',
        why_useful: '',
        vision_text: '',
        meta_text: '',
        extracted_text: r.text,
        domain: 'example.com',
        kind: 'article'
      })
    }
    const hits = db
      .prepare(
        `SELECT item_id, bm25(items_fts, 0, 8, 6, 4, 4, 3, 3, 3, 2, 1, 2, 2) AS score
         FROM items_fts WHERE items_fts MATCH ? ORDER BY score`
      )
      .all('"inference"') as { item_id: string; score: number }[]
    expect(hits.map((h) => h.item_id).sort()).toEqual(['i1', 'i3'])
    for (const h of hits) expect(h.score).toBeLessThan(0)

    const prefix = db.prepare('SELECT item_id FROM items_fts WHERE items_fts MATCH ? ORDER BY rank').all('"glob"*') as {
      item_id: string
    }[]
    expect(prefix.map((h) => h.item_id)).toEqual(['i2'])

    // Porter stemming + diacritics removal.
    const stemmed = db.prepare('SELECT item_id FROM items_fts WHERE items_fts MATCH ?').all('"strategy"') as {
      item_id: string
    }[]
    expect(stemmed.map((h) => h.item_id)).toEqual(['i1'])

    // Column filter and snippet work on the content-storing table.
    const snippet = db
      .prepare("SELECT snippet(items_fts, 9, '[', ']', '…', 6) AS s FROM items_fts WHERE items_fts MATCH ?")
      .get('extracted_text:"pricing"') as { s: string }
    expect(snippet.s).toContain('[pricing]')
  })

  it('rejects a second active job for the same item and stage, but allows history and batch jobs', () => {
    insert(db, 'items', itemRow('a', 'A'))
    const job = (id: string, status: string, itemId: string | null = 'a', stage = 'extract'): void =>
      insert(db, 'jobs', {
        id,
        item_id: itemId,
        batch_id: itemId ? null : 'batch-1',
        stage,
        lane: 'io',
        priority: 0,
        status,
        attempts: 0,
        run_after: null,
        last_error: null,
        created_at: NOW,
        updated_at: NOW
      })
    job('j1', 'queued')
    expect(() => job('j2', 'running')).toThrow(/UNIQUE/)
    expect(() => job('j2', 'queued')).toThrow(/UNIQUE/)
    // A different stage for the same item is fine.
    job('j3', 'queued', 'a', 'thumbnail')
    // Finished jobs do not block a new active one.
    db.prepare("UPDATE jobs SET status = 'done' WHERE id = 'j1'").run()
    job('j4', 'queued')
    // Batch-level jobs (item_id NULL) are not constrained by the partial index.
    job('b1', 'queued', null, 'organize_batch')
    job('b2', 'queued', null, 'organize_batch')
    expect((db.prepare('SELECT count(*) AS n FROM jobs').get() as { n: number }).n).toBe(5)
  })
})
