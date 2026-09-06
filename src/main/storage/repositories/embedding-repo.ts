import type { EmbeddingMeta } from '../../../shared/types'
import type { Db } from '../db'
import { numOr, type Row, requireText } from './rows'

/** One embedding row with its vector decoded. */
export interface EmbeddingRow extends EmbeddingMeta {
  vector: Float32Array
}

/** Encode a Float32Array as the little-endian BLOB stored in `embeddings.vector`. */
export function vectorToBlob(vector: Float32Array): Uint8Array {
  return new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength)
}

/** Decode a BLOB into a Float32Array (copies to guarantee alignment). The BLOB length is the source of truth; `dims` only caps it. */
export function blobToVector(blob: Uint8Array, dims: number): Float32Array {
  const copy = new Uint8Array(blob.byteLength)
  copy.set(blob)
  const stored = Math.floor(copy.byteLength / 4)
  return new Float32Array(copy.buffer, 0, dims > 0 ? Math.min(dims, stored) : stored)
}

function rowToEmbedding(row: Row): EmbeddingRow {
  const dims = numOr(row.dims, 0)
  return {
    itemId: requireText(row.item_id, 'item_id'),
    chunkIndex: numOr(row.chunk_index, 0),
    role: requireText(row.role, 'role') as EmbeddingMeta['role'],
    content: requireText(row.content, 'content'),
    model: requireText(row.model, 'model'),
    dims,
    vector: row.vector instanceof Uint8Array ? blobToVector(row.vector, dims) : new Float32Array(0)
  }
}

export interface EmbeddingRepo {
  /** Delete every chunk of the item, then insert `rows` (one transaction by the caller). */
  replaceForItem(itemId: string, rows: readonly EmbeddingRow[]): void
  /** Replace only the given chunk indexes (e.g. chunk 0 after re-indexing). */
  upsert(rows: readonly EmbeddingRow[]): void
  forItem(itemId: string): EmbeddingRow[]
  /** All rows for one model (vector matrix load at startup). */
  allForModel(model: string): EmbeddingRow[]
  deleteForItem(itemId: string): void
  countForModel(model: string): number
}

export function createEmbeddingRepo(db: Db): EmbeddingRepo {
  const upsertSql = `INSERT INTO embeddings (item_id, chunk_index, role, content, vector, model, dims) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (item_id, chunk_index) DO UPDATE SET role = excluded.role, content = excluded.content,
     vector = excluded.vector, model = excluded.model, dims = excluded.dims`
  const upsert = (rows: readonly EmbeddingRow[]): void => {
    for (const r of rows) {
      db.prepare(upsertSql).run(r.itemId, r.chunkIndex, r.role, r.content, vectorToBlob(r.vector), r.model, r.dims)
    }
  }
  return {
    replaceForItem(itemId, rows) {
      db.prepare('DELETE FROM embeddings WHERE item_id = ?').run(itemId)
      upsert(rows)
    },
    upsert,
    forItem(itemId) {
      return (db.prepare('SELECT * FROM embeddings WHERE item_id = ? ORDER BY chunk_index').all(itemId) as Row[]).map(
        rowToEmbedding
      )
    },
    allForModel(model) {
      return (
        db
          .prepare(
            `SELECT e.* FROM embeddings e JOIN items i ON i.id = e.item_id
             WHERE e.model = ? AND i.deleted_at IS NULL ORDER BY e.item_id, e.chunk_index`
          )
          .all(model) as Row[]
      ).map(rowToEmbedding)
    },
    deleteForItem(itemId) {
      db.prepare('DELETE FROM embeddings WHERE item_id = ?').run(itemId)
    },
    countForModel(model) {
      return numOr((db.prepare('SELECT count(*) AS n FROM embeddings WHERE model = ?').get(model) as Row).n, 0)
    }
  }
}
