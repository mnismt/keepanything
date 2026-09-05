import { normalizeName } from '../../shared/text'
import type {
  Collection,
  CollectionCreator,
  CollectionItem,
  CollectionSummary,
  MembershipActor
} from '../../shared/types'
import type { Clock, EventBus } from '../ports'
import type { Db } from '../storage/db'
import type { Repositories } from '../storage/repositories'
import { AUDIT_ACTIONS, type AuditService, membershipKey } from './audit'
import { KaError } from './errors'
import { type IdGenerator, uuid } from './ids'

export interface CreateCollectionInput {
  name: string
  description?: string | null
  createdBy: CollectionCreator
  agentRunId?: string | null
  color?: string | null
}

export interface AddMemberInput {
  itemId: string
  confidence?: number | null
  reason?: string | null
}

/** Why a member was not added. */
export type SkipReason = 'exists' | 'suppressed' | 'missing'

export interface AddItemsResult {
  added: string[]
  skipped: { itemId: string; reason: SkipReason }[]
}

export interface CollectionService {
  /** Throws `VALIDATION` on an empty name, `CONFLICT` on a duplicate (normalized) name. */
  create(input: CreateCollectionInput): Collection
  /** Throws `NOT_FOUND`. */
  get(id: string): Collection
  list(): CollectionSummary[]
  /** Agents may not rename user-created collections (`CONFLICT`). */
  rename(
    id: string,
    name: string,
    description: string | null | undefined,
    opts: { actor: 'user' | 'agent'; agentRunId?: string | null }
  ): Collection
  delete(id: string, opts: { actor: 'user' | 'agent' }): void
  /**
   * Add members. Agent actors skip suppressed pairs; the user actor clears suppressions.
   * Existing members and unknown items are skipped, never errors.
   */
  addItems(
    id: string,
    members: readonly AddMemberInput[],
    opts: { actor: MembershipActor; agentRunId?: string | null }
  ): AddItemsResult
  /** Remove one member. A user removal writes both `collection_member` suppression keys. */
  removeItem(id: string, itemId: string, opts: { actor: 'user' | 'agent' }): void
  /** True when the agent must not (re-)add `itemId` to this collection. */
  isSuppressed(collection: Collection, itemId: string): boolean
}

export interface CollectionServiceDeps {
  db: Db
  repos: Repositories
  events: EventBus
  clock: Clock
  audit: AuditService
  ids?: IdGenerator
}

export function createCollectionService(deps: CollectionServiceDeps): CollectionService {
  const { db, repos, events, clock, audit } = deps
  const ids = deps.ids ?? uuid
  const { collections, suppressions, items } = repos

  const changed = (itemIds: string[] = []): void => {
    db.afterCommit(() => {
      events.emit('collections.changed', {})
      if (itemIds.length > 0) {
        events.emit('item.updated', {
          reason: 'updated',
          ids: itemIds,
          summaries: items.summaries(items.getMany(itemIds))
        })
      }
    })
  }

  const get = (id: string): Collection => {
    const c = collections.get(id)
    if (!c) throw new KaError('NOT_FOUND', "Couldn't find that collection.")
    return c
  }

  const validName = (name: string): { name: string; nameKey: string } => {
    const trimmed = name.trim().replace(/\s+/g, ' ')
    const nameKey = normalizeName(trimmed)
    if (trimmed.length === 0 || nameKey.length === 0) throw new KaError('VALIDATION', 'Give it a name.')
    if (trimmed.length > 80) throw new KaError('VALIDATION', 'Keep the name under 80 characters.')
    return { name: trimmed, nameKey }
  }

  const isSuppressed = (collection: Collection, itemId: string): boolean =>
    suppressions.has('collection_member', membershipKey(collection.id, itemId)) ||
    suppressions.has('collection_member', `name:${collection.nameKey}:${itemId}`)

  return {
    create(input) {
      return db.transaction(() => {
        const { name, nameKey } = validName(input.name)
        if (collections.getByNameKey(nameKey))
          throw new KaError('CONFLICT', 'A collection with that name already exists.')
        const now = clock.nowIso()
        const collection: Collection = {
          id: ids(),
          name,
          nameKey,
          description: input.description?.trim() || null,
          createdBy: input.createdBy,
          color: input.color ?? null,
          pinned: false,
          createdAt: now,
          updatedAt: now
        }
        collections.insert(collection)
        audit.record({
          actor: input.createdBy,
          action: AUDIT_ACTIONS.createCollection,
          entity: 'collection',
          entityId: collection.id,
          after: { collection },
          agentRunId: input.agentRunId ?? null
        })
        changed()
        return collection
      })
    },
    get,
    list: () => collections.listSummaries(),
    rename(id, name, description, opts) {
      return db.transaction(() => {
        const current = get(id)
        if (opts.actor === 'agent' && current.createdBy === 'user') {
          throw new KaError('CONFLICT', 'That collection was named by the user.')
        }
        const next = validName(name)
        const clash = collections.getByNameKey(next.nameKey)
        if (clash && clash.id !== id) throw new KaError('CONFLICT', 'A collection with that name already exists.')
        const now = clock.nowIso()
        const patch = {
          name: next.name,
          nameKey: next.nameKey,
          description: description === undefined ? current.description : description?.trim() || null,
          updatedAt: now
        }
        collections.update(id, patch)
        audit.record({
          actor: opts.actor,
          action: AUDIT_ACTIONS.renameCollection,
          entity: 'collection',
          entityId: id,
          before: { name: current.name, nameKey: current.nameKey, description: current.description },
          after: { name: patch.name, nameKey: patch.nameKey, description: patch.description },
          agentRunId: opts.agentRunId ?? null
        })
        changed()
        return { ...current, ...patch }
      })
    },
    delete(id, opts) {
      db.transaction(() => {
        const current = get(id)
        const members = collections.members(id)
        collections.delete(id)
        audit.record({
          actor: opts.actor,
          action: AUDIT_ACTIONS.deleteCollection,
          entity: 'collection',
          entityId: id,
          before: { collection: current, members }
        })
        changed(members.map((m) => m.itemId))
      })
    },
    addItems(id, members, opts) {
      return db.transaction(() => {
        const collection = get(id)
        const now = clock.nowIso()
        const result: AddItemsResult = { added: [], skipped: [] }
        for (const m of members) {
          if (!items.get(m.itemId)) {
            result.skipped.push({ itemId: m.itemId, reason: 'missing' })
            continue
          }
          if (collections.getMember(id, m.itemId)) {
            result.skipped.push({ itemId: m.itemId, reason: 'exists' })
            continue
          }
          if (opts.actor === 'user') {
            suppressions.remove('collection_member', membershipKey(id, m.itemId))
            suppressions.remove('collection_member', `name:${collection.nameKey}:${m.itemId}`)
          } else if (isSuppressed(collection, m.itemId)) {
            result.skipped.push({ itemId: m.itemId, reason: 'suppressed' })
            continue
          }
          const membership: CollectionItem = {
            collectionId: id,
            itemId: m.itemId,
            confidence: m.confidence ?? null,
            reason: m.reason?.trim() || null,
            addedBy: opts.actor,
            agentRunId: opts.agentRunId ?? null,
            addedAt: now
          }
          collections.addMember(membership)
          audit.record({
            actor: opts.actor,
            action: AUDIT_ACTIONS.addToCollection,
            entity: 'collection_item',
            entityId: membershipKey(id, m.itemId),
            after: membership,
            agentRunId: opts.agentRunId ?? null
          })
          result.added.push(m.itemId)
        }
        if (result.added.length > 0) {
          collections.update(id, { updatedAt: now })
          changed(result.added)
        }
        return result
      })
    },
    removeItem(id, itemId, opts) {
      db.transaction(() => {
        const collection = get(id)
        const membership = collections.getMember(id, itemId)
        if (!membership) return
        const now = clock.nowIso()
        collections.removeMember(id, itemId)
        if (opts.actor === 'user') {
          suppressions.add('collection_member', membershipKey(id, itemId), now)
          suppressions.add('collection_member', `name:${collection.nameKey}:${itemId}`, now)
        }
        audit.record({
          actor: opts.actor,
          action: AUDIT_ACTIONS.removeFromCollection,
          entity: 'collection_item',
          entityId: membershipKey(id, itemId),
          before: membership
        })
        collections.update(id, { updatedAt: now })
        changed([itemId])
      })
    },
    isSuppressed
  }
}
