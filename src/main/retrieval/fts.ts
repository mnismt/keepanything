/**
 * FTS5 leg of retrieval: BM25 with the agreed column weights, `snippet()` for the
 * highlighted excerpt and per-column `highlight()` markers to report which fields matched.
 */

import type { Db } from '../storage/db'
import type { Row } from '../storage/repositories/rows'

/** One FTS hit. `bm25` is SQLite's rank (negative, more negative = better). */
export interface FtsHit {
  itemId: string
  bm25: number
  /** 0..1, best hit of the result set = 1. */
  bm25Norm: number
  snippet: string
  matchedFields: string[]
}

/** FTS columns in table order (index 1..11; 0 is `item_id UNINDEXED`). */
export const FTS_COLUMNS = [
  'title',
  'retrieval_hints',
  'topics',
  'entities',
  'understanding',
  'why_useful',
  'vision_text',
  'meta_text',
  'extracted_text',
  'domain',
  'kind'
] as const

/** BM25 weights per column (title 8, hints 6, topics/entities 4, understanding/why/vision 3, meta 2, text 1, domain 2, kind 2). */
export const BM25_WEIGHTS = [0, 8, 6, 4, 4, 3, 3, 3, 2, 1, 2, 2] as const

/** Markers wrapped around matches in snippets (the renderer turns them into emphasis). */
export const SNIPPET_OPEN = '[['
export const SNIPPET_CLOSE = ']]'

const MARK = ''

const SQL = `SELECT item_id,
  bm25(items_fts, ${BM25_WEIGHTS.join(', ')}) AS rank,
  snippet(items_fts, -1, '${SNIPPET_OPEN}', '${SNIPPET_CLOSE}', '…', 14) AS snip,
  ${FTS_COLUMNS.map((c, i) => `instr(highlight(items_fts, ${i + 1}, char(1), ''), char(1)) AS m_${c}`).join(',\n  ')}
FROM items_fts WHERE items_fts MATCH ? ORDER BY rank, item_id LIMIT ?`

/** Run one MATCH. Malformed expressions return an empty list instead of throwing. */
export function ftsSearch(db: Db, match: string, limit: number): FtsHit[] {
  let rows: Row[]
  try {
    rows = db.prepare(SQL).all(match, Math.max(1, limit)) as Row[]
  } catch {
    return []
  }
  if (rows.length === 0) return []
  const ranks = rows.map((r) => (typeof r.rank === 'number' ? r.rank : 0))
  const best = Math.min(...ranks)
  return rows.map((row, i) => {
    const rank = ranks[i] ?? 0
    const matched: string[] = []
    for (const column of FTS_COLUMNS) {
      const value = row[`m_${column}`]
      if ((typeof value === 'number' && value > 0) || (typeof value === 'bigint' && value > 0n)) matched.push(column)
    }
    return {
      itemId: String(row.item_id),
      bm25: rank,
      bm25Norm: best < 0 ? Math.min(1, rank / best) : 1,
      snippet: typeof row.snip === 'string' ? cleanSnippet(row.snip) : '',
      matchedFields: matched
    }
  })
}

function cleanSnippet(text: string): string {
  return text.replace(/\s+/g, ' ').replace(MARK, '').trim()
}
