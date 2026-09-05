import { relationshipSuppressionKey } from '../../shared/kinds'
import type { AuditActor, AuditEntry, Collection, CollectionItem, Item, Relationship } from '../../shared/types'
import type { Clock, EventBus } from '../ports'
import type { Db } from '../storage/db'
import type { Repositories } from '../storage/repositories'
import { KaError } from './errors'
import { type IdGenerator, uuid } from './ids'

/** Audited actions. `before`/`after` shapes are documented per action in `undo()`. */
export const AUDIT_ACTIONS = {
  createCollection: 'create_collection',
  renameCollection: 'rename_collection',
  deleteCollection: 'delete_collection',
  addToCollection: 'add_to_collection',
  removeFromCollection: 'remove_from_collection',
  createRelationship: 'create_relationship',
  removeRelationship: 'remove_relationship',
  updateItem: 'update_item',
  updateUnderstanding: 'update_understanding',
  createNote: 'create_note',
  keptAgain: 'kept_again',
  trashItem: 'trash_item',
  restoreItem: 'restore_item'
} as const

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS]

/** Id/timestamp are filled in. */
export interface AuditInput {
  actor: AuditActor
  action: AuditAction
  entity: 'item' | 'collection' | 'collection_item' | 'relationship'
  entityId: string
  before?: unknown
  after?: unknown
  agentRunId?: string | null
}

/** Membership key used in `entity_id` for `collection_item` rows. */
export function membershipKey(collectionId: string, itemId: string): string {
  return `${collectionId}:${itemId}`
}

/** Audit writes and undo. */
export interface AuditService {
  record(input: AuditInput): AuditEntry
  /** Revert one entry. Throws `CONFLICT` when already undone or not undoable, `NOT_FOUND` when unknown. */
  undo(auditId: string): AuditEntry
  get(auditId: string): AuditEntry | null
}

export interface AuditDeps {
  db: Db
  repos: Repositories
  events: EventBus
  clock: Clock
  ids?: IdGenerator
}

export function createAuditService(deps: AuditDeps): AuditService {
  const { db, repos, events, clock } = deps
  const ids = deps.ids ?? uuid

  const record = (input: AuditInput): AuditEntry => {
    const entry: AuditEntry = {
      id: ids(),
      actor: input.actor,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      before: input.before ?? null,
      after: input.after ?? null,
      agentRunId: input.agentRunId ?? null,
      createdAt: clock.nowIso(),
      undoneAt: null
    }
    repos.audit.insert(entry)
    return entry
  }

  const emitItems = (reason: 'updated' | 'trashed' | 'restored', itemIds: string[]): void => {
    if (itemIds.length === 0) return
    db.afterCommit(() => {
      const items = repos.items.getMany(itemIds)
      events.emit(reason === 'updated' ? 'item.updated' : reason === 'trashed' ? 'item.trashed' : 'item.restored', {
        reason,
        ids: itemIds,
        summaries: repos.items.summaries(items)
      })
    })
  }
  const emitCollections = (): void => {
    db.afterCommit(() => events.emit('collections.changed', {}))
  }

  const isAgentFact = (entry: AuditEntry): boolean => entry.actor === 'agent'

  const undoEntry = (entry: AuditEntry, now: string): void => {
    switch (entry.action) {
      case AUDIT_ACTIONS.createCollection: {
        // after = { collection, members }
        const after = entry.after as { collection: Collection; members?: CollectionItem[] } | null
        const collection = repos.collections.get(entry.entityId) ?? after?.collection ?? null
        if (isAgentFact(entry) && collection) {
          for (const m of repos.collections.members(collection.id)) {
            repos.suppressions.add('collection_member', `name:${collection.nameKey}:${m.itemId}`, now)
          }
        }
        repos.collections.delete(entry.entityId)
        emitCollections()
        return
      }
      case AUDIT_ACTIONS.renameCollection: {
        const before = entry.before as Pick<Collection, 'name' | 'nameKey' | 'description'> | null
        if (!before) throw new KaError('CONFLICT', "Can't undo that.")
        const clash = repos.collections.getByNameKey(before.nameKey)
        if (clash && clash.id !== entry.entityId)
          throw new KaError('CONFLICT', 'A collection with that name already exists.')
        repos.collections.update(entry.entityId, { ...before, updatedAt: now })
        emitCollections()
        return
      }
      case AUDIT_ACTIONS.deleteCollection: {
        const before = entry.before as { collection: Collection; members: CollectionItem[] } | null
        if (!before) throw new KaError('CONFLICT', "Can't undo that.")
        if (repos.collections.getByNameKey(before.collection.nameKey)) {
          throw new KaError('CONFLICT', 'A collection with that name already exists.')
        }
        repos.collections.insert(before.collection)
        for (const m of before.members) if (repos.items.get(m.itemId)) repos.collections.addMember(m)
        emitCollections()
        emitItems(
          'updated',
          before.members.map((m) => m.itemId)
        )
        return
      }
      case AUDIT_ACTIONS.addToCollection: {
        const after = entry.after as CollectionItem | null
        if (!after) throw new KaError('CONFLICT', "Can't undo that.")
        repos.collections.removeMember(after.collectionId, after.itemId)
        if (isAgentFact(entry)) {
          repos.suppressions.add('collection_member', membershipKey(after.collectionId, after.itemId), now)
          const collection = repos.collections.get(after.collectionId)
          if (collection) repos.suppressions.add('collection_member', `name:${collection.nameKey}:${after.itemId}`, now)
        }
        emitCollections()
        emitItems('updated', [after.itemId])
        return
      }
      case AUDIT_ACTIONS.removeFromCollection: {
        const before = entry.before as CollectionItem | null
        if (!before) throw new KaError('CONFLICT', "Can't undo that.")
        const collection = repos.collections.get(before.collectionId)
        if (!collection || !repos.items.get(before.itemId))
          throw new KaError('NOT_FOUND', 'That collection or item is gone.')
        if (!repos.collections.getMember(before.collectionId, before.itemId)) repos.collections.addMember(before)
        repos.suppressions.remove('collection_member', membershipKey(before.collectionId, before.itemId))
        repos.suppressions.remove('collection_member', `name:${collection.nameKey}:${before.itemId}`)
        emitCollections()
        emitItems('updated', [before.itemId])
        return
      }
      case AUDIT_ACTIONS.createRelationship: {
        const after = entry.after as Relationship | null
        if (!after) throw new KaError('CONFLICT', "Can't undo that.")
        repos.relationships.delete(after.id)
        if (isAgentFact(entry)) {
          repos.suppressions.add(
            'relationship',
            relationshipSuppressionKey(after.sourceItemId, after.targetItemId),
            now
          )
        }
        emitItems('updated', [after.sourceItemId, after.targetItemId])
        return
      }
      case AUDIT_ACTIONS.removeRelationship: {
        const before = entry.before as Relationship | null
        if (!before) throw new KaError('CONFLICT', "Can't undo that.")
        if (!repos.items.get(before.sourceItemId) || !repos.items.get(before.targetItemId)) {
          throw new KaError('NOT_FOUND', 'One of those items is gone.')
        }
        if (!repos.relationships.find(before.sourceItemId, before.targetItemId, before.type))
          repos.relationships.insert(before)
        repos.suppressions.remove('relationship', relationshipSuppressionKey(before.sourceItemId, before.targetItemId))
        emitItems('updated', [before.sourceItemId, before.targetItemId])
        return
      }
      case AUDIT_ACTIONS.updateItem:
      case AUDIT_ACTIONS.updateUnderstanding: {
        const before = entry.before as Partial<Item> | null
        if (!before || !repos.items.get(entry.entityId)) throw new KaError('NOT_FOUND', 'That item is gone.')
        repos.items.update(entry.entityId, { ...before, modifiedAt: now })
        emitItems('updated', [entry.entityId])
        return
      }
      case AUDIT_ACTIONS.createNote: {
        if (!repos.items.get(entry.entityId)) throw new KaError('NOT_FOUND', 'That note is gone.')
        repos.jobs.cancelForItems([entry.entityId], now)
        repos.items.setDeleted([entry.entityId], now)
        emitItems('trashed', [entry.entityId])
        return
      }
      case AUDIT_ACTIONS.trashItem: {
        const idsToRestore = (entry.after as { ids?: string[] } | null)?.ids ?? [entry.entityId]
        repos.items.setDeleted(idsToRestore, null)
        emitItems('restored', idsToRestore)
        return
      }
      case AUDIT_ACTIONS.restoreItem: {
        const idsToTrash = (entry.after as { ids?: string[] } | null)?.ids ?? [entry.entityId]
        repos.jobs.cancelForItems(idsToTrash, now)
        repos.items.setDeleted(idsToTrash, now)
        emitItems('trashed', idsToTrash)
        return
      }
      case AUDIT_ACTIONS.keptAgain:
        throw new KaError('CONFLICT', 'Nothing to undo there.')
      default:
        throw new KaError('CONFLICT', "Can't undo that.")
    }
  }

  return {
    record,
    get: (id) => repos.audit.get(id),
    undo(auditId) {
      return db.transaction(() => {
        const entry = repos.audit.get(auditId)
        if (!entry) throw new KaError('NOT_FOUND', "Couldn't find that change.")
        if (entry.undoneAt) throw new KaError('CONFLICT', 'Already undone.')
        const now = clock.nowIso()
        undoEntry(entry, now)
        repos.audit.markUndone(entry.id, now)
        return { ...entry, undoneAt: now }
      })
    }
  }
}
