import { toMediaUrl } from '../../../shared/media'
import type { Collection, CollectionItem, CollectionSummary } from '../../../shared/types'
import type { Db } from '../db'
import { numOr, type Row, requireText, text, toBool } from './rows'

export function rowToCollection(row: Row): Collection {
  return {
    id: requireText(row.id, 'id'),
    name: requireText(row.name, 'name'),
    nameKey: requireText(row.name_key, 'name_key'),
    description: text(row.description),
    createdBy: requireText(row.created_by, 'created_by') as Collection['createdBy'],
    color: text(row.color),
    pinned: toBool(row.pinned),
    createdAt: requireText(row.created_at, 'created_at'),
    updatedAt: requireText(row.updated_at, 'updated_at')
  }
}

export function rowToMembership(row: Row): CollectionItem {
  return {
    collectionId: requireText(row.collection_id, 'collection_id'),
    itemId: requireText(row.item_id, 'item_id'),
    confidence: typeof row.confidence === 'number' ? row.confidence : null,
    reason: text(row.reason),
    addedBy: requireText(row.added_by, 'added_by') as CollectionItem['addedBy'],
    agentRunId: text(row.agent_run_id),
    addedAt: requireText(row.added_at, 'added_at')
  }
}

/** Collection repository. Callers own transactions. */
export interface CollectionRepo {
  insert(collection: Collection): void
  get(id: string): Collection | null
  getByNameKey(nameKey: string): Collection | null
  update(
    id: string,
    patch: Partial<Pick<Collection, 'name' | 'nameKey' | 'description' | 'color' | 'pinned' | 'updatedAt'>>
  ): void
  delete(id: string): void
  list(): Collection[]
  /** Summaries with member count and up to 4 cover thumbnails (non-deleted members only). */
  listSummaries(): CollectionSummary[]
  addMember(member: CollectionItem): void
  removeMember(collectionId: string, itemId: string): void
  getMember(collectionId: string, itemId: string): CollectionItem | null
  members(collectionId: string): CollectionItem[]
  membershipsForItem(itemId: string): CollectionItem[]
  memberCount(collectionId: string): number
}

export function createCollectionRepo(db: Db): CollectionRepo {
  const get = (id: string): Collection | null => {
    const row = db.prepare('SELECT * FROM collections WHERE id = ?').get(id) as Row | undefined
    return row ? rowToCollection(row) : null
  }
  return {
    insert(c) {
      db.prepare(
        `INSERT INTO collections (id, name, name_key, description, created_by, color, pinned, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(c.id, c.name, c.nameKey, c.description, c.createdBy, c.color, c.pinned ? 1 : 0, c.createdAt, c.updatedAt)
    },
    get,
    getByNameKey(nameKey) {
      const row = db.prepare('SELECT * FROM collections WHERE name_key = ?').get(nameKey) as Row | undefined
      return row ? rowToCollection(row) : null
    },
    update(id, patch) {
      const sets: string[] = []
      const params: (string | number | null)[] = []
      if (patch.name !== undefined) sets.push('name = ?'), params.push(patch.name)
      if (patch.nameKey !== undefined) sets.push('name_key = ?'), params.push(patch.nameKey)
      if (patch.description !== undefined) sets.push('description = ?'), params.push(patch.description)
      if (patch.color !== undefined) sets.push('color = ?'), params.push(patch.color)
      if (patch.pinned !== undefined) sets.push('pinned = ?'), params.push(patch.pinned ? 1 : 0)
      if (patch.updatedAt !== undefined) sets.push('updated_at = ?'), params.push(patch.updatedAt)
      if (sets.length === 0) return
      db.prepare(`UPDATE collections SET ${sets.join(', ')} WHERE id = ?`).run(...params, id)
    },
    delete(id) {
      db.prepare('DELETE FROM collections WHERE id = ?').run(id)
    },
    list() {
      return (db.prepare('SELECT * FROM collections ORDER BY pinned DESC, name COLLATE NOCASE').all() as Row[]).map(
        rowToCollection
      )
    },
    listSummaries() {
      const rows = db
        .prepare(
          `SELECT c.*, (SELECT count(*) FROM collection_items ci JOIN items i ON i.id = ci.item_id
                        WHERE ci.collection_id = c.id AND i.deleted_at IS NULL) AS count
           FROM collections c ORDER BY c.pinned DESC, c.name COLLATE NOCASE`
        )
        .all() as Row[]
      const covers = db.prepare(
        `SELECT i.thumbnail_path, i.media_version FROM collection_items ci JOIN items i ON i.id = ci.item_id
         WHERE ci.collection_id = ? AND i.deleted_at IS NULL AND i.thumbnail_path IS NOT NULL
         ORDER BY ci.added_at DESC LIMIT 4`
      )
      return rows.map((row) => {
        const collection = rowToCollection(row)
        const thumbs = (covers.all(collection.id) as Row[]).map((r) =>
          toMediaUrl('thumbs', String(r.thumbnail_path), numOr(r.media_version, 1))
        )
        return { ...collection, count: numOr(row.count, 0), coverThumbnailUrls: thumbs }
      })
    },
    addMember(m) {
      db.prepare(
        `INSERT INTO collection_items (collection_id, item_id, confidence, reason, added_by, agent_run_id, added_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(m.collectionId, m.itemId, m.confidence, m.reason, m.addedBy, m.agentRunId, m.addedAt)
    },
    removeMember(collectionId, itemId) {
      db.prepare('DELETE FROM collection_items WHERE collection_id = ? AND item_id = ?').run(collectionId, itemId)
    },
    getMember(collectionId, itemId) {
      const row = db
        .prepare('SELECT * FROM collection_items WHERE collection_id = ? AND item_id = ?')
        .get(collectionId, itemId) as Row | undefined
      return row ? rowToMembership(row) : null
    },
    members(collectionId) {
      return (
        db
          .prepare('SELECT * FROM collection_items WHERE collection_id = ? ORDER BY added_at')
          .all(collectionId) as Row[]
      ).map(rowToMembership)
    },
    membershipsForItem(itemId) {
      return (
        db.prepare('SELECT * FROM collection_items WHERE item_id = ? ORDER BY added_at').all(itemId) as Row[]
      ).map(rowToMembership)
    },
    memberCount(collectionId) {
      return numOr(
        (db.prepare('SELECT count(*) AS n FROM collection_items WHERE collection_id = ?').get(collectionId) as Row).n,
        0
      )
    }
  }
}
