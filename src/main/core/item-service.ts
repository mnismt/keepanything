import type { ItemsListRequest, ItemUpdatePatch } from '../../shared/ipc'
import { relationshipLabel } from '../../shared/kinds'
import { toMediaUrl } from '../../shared/media'
import { isTerminal } from '../../shared/status'
import type {
  Item,
  ItemDetail,
  ItemDetailCollection,
  ItemDetailRelationship,
  ItemSummary,
  Job,
  Stage,
  Understanding,
  UserOverridableField
} from '../../shared/types'
import type { Clock, EventBus } from '../ports'
import type { Db } from '../storage/db'
import type { Repositories } from '../storage/repositories'
import { AUDIT_ACTIONS, type AuditService } from './audit'
import { KaError } from './errors'
import { type IdGenerator, uuid } from './ids'

/** What the item service needs from the pipeline (implemented by `pipeline/queue.ts`). */
export interface ItemPipeline {
  enqueueInitial(item: Item): unknown
  enqueueFrom(item: Item, from?: Stage): unknown
  cancelForItems(itemIds: readonly string[]): Job[]
}

/** Everything optional except type and title. */
export type NewItemInput = Partial<Omit<Item, 'id' | 'type' | 'title'>> & Pick<Item, 'type' | 'title'> & { id?: string }

/** Understanding fields the user may override, in the order they are applied. */
const OVERRIDABLE: readonly UserOverridableField[] = [
  'title',
  'understanding',
  'whyUseful',
  'kind',
  'topics',
  'entities'
]

/** Status an item is reset to when reprocessing from a given stage (null = keep). */
export function statusForReprocess(from: Stage | undefined): Item['processingStatus'] | null {
  switch (from) {
    case undefined:
    case 'extract':
    case 'thumbnail':
    case 'snapshot':
      return 'CAPTURED'
    case 'embed':
    case 'understand':
      return 'EXTRACTED'
    default:
      return null
  }
}

/** Item domain service. Every mutation is one transaction. */
export interface ItemService {
  /** Insert a new item at `CAPTURED` (or the given status). Does not enqueue jobs. */
  create(input: NewItemInput): Item
  /** Throws `NOT_FOUND`. */
  get(id: string): Item
  find(id: string): Item | null
  list(request: ItemsListRequest): ItemSummary[]
  summary(id: string): ItemSummary | null
  summaries(items: readonly Item[]): ItemSummary[]
  detail(id: string): ItemDetail
  /** Writes fields, marks `user_overrides`, audits, re-indexes. */
  updateByUser(id: string, patch: ItemUpdatePatch): ItemDetail
  /** Agent/system write honouring `user_overrides`. Returns the fields it skipped. */
  applyUnderstanding(
    id: string,
    understanding: Understanding,
    opts?: { agentRunId?: string | null; actor?: 'agent' | 'system' }
  ): { item: Item; skippedFields: UserOverridableField[] }
  trash(ids: readonly string[]): void
  restore(ids: readonly string[]): void
  /** Hard delete. Returns the removed rows so the caller can purge managed files. */
  deleteForever(ids: readonly string[]): Item[]
  /** Stop processing without deleting: cancels queued/running jobs and settles the items at `PARTIAL`. */
  cancelProcessing(ids: readonly string[]): void
  reprocess(id: string, from?: Stage): void
  reprocessAll(from?: Stage): number
  /** Bump `last_kept_at`, audit `kept_again`. */
  keptAgain(id: string): Item
  /** Update the missing-original cache. */
  setMissing(id: string, isMissing: boolean): Item
}

export interface ItemServiceDeps {
  db: Db
  repos: Repositories
  events: EventBus
  clock: Clock
  audit: AuditService
  pipeline: ItemPipeline
  ids?: IdGenerator
}

export function createItemService(deps: ItemServiceDeps): ItemService {
  const { db, repos, events, clock, audit, pipeline } = deps
  const ids = deps.ids ?? uuid
  const { items } = repos

  const emit = (
    event: 'item.created' | 'item.updated' | 'item.trashed' | 'item.restored' | 'item.deleted',
    idList: string[]
  ): void => {
    if (idList.length === 0) return
    const reason = event.slice('item.'.length) as 'created' | 'updated' | 'trashed' | 'restored' | 'deleted'
    db.afterCommit(() => {
      const payload =
        reason === 'deleted'
          ? { reason, ids: idList }
          : { reason, ids: idList, summaries: items.summaries(items.getMany(idList)) }
      events.emit(event, payload)
    })
  }

  const get = (id: string): Item => {
    const item = items.get(id)
    if (!item) throw new KaError('NOT_FOUND', "Couldn't find that item.")
    return item
  }

  const detail = (id: string): ItemDetail => {
    const item = get(id)
    const relationships: ItemDetailRelationship[] = []
    for (const r of repos.relationships.forItem(id)) {
      const direction = r.sourceItemId === id ? 'out' : 'in'
      const otherId = direction === 'out' ? r.targetItemId : r.sourceItemId
      const other = items.summary(otherId)
      if (!other) continue
      relationships.push({ ...r, direction, label: relationshipLabel(r.type, direction), other })
    }
    const collections: ItemDetailCollection[] = []
    for (const m of repos.collections.membershipsForItem(id)) {
      const c = repos.collections.get(m.collectionId)
      if (!c) continue
      collections.push({
        ...c,
        confidence: m.confidence,
        reason: m.reason,
        addedBy: m.addedBy,
        agentRunId: m.agentRunId,
        addedAt: m.addedAt
      })
    }
    const result: ItemDetail = {
      item,
      summary: items.summary(id) ?? summaryOf(item),
      originalUrl: item.managedPath ? toMediaUrl('objects', item.managedPath, item.mediaVersion) : null,
      relationships,
      collections,
      latestRuns: repos.agentRuns.latestForItem(id, 5)
    }
    if (item.type === 'folder') result.children = items.summaries(items.children(id))
    return result
  }

  const summaryOf = (item: Item): ItemSummary => items.summaries([item])[0] as ItemSummary

  return {
    create(input) {
      const now = clock.nowIso()
      const item: Item = {
        id: input.id ?? ids(),
        type: input.type,
        subtype: input.subtype ?? null,
        kind: input.kind ?? null,
        title: input.title.trim().length > 0 ? input.title.trim() : 'Untitled',
        originalPath: input.originalPath ?? null,
        managedPath: input.managedPath ?? null,
        url: input.url ?? null,
        canonicalUrl: input.canonicalUrl ?? null,
        domain: input.domain ?? null,
        mimeType: input.mimeType ?? null,
        size: input.size ?? null,
        contentHash: input.contentHash ?? null,
        width: input.width ?? null,
        height: input.height ?? null,
        durationMs: input.durationMs ?? null,
        pageCount: input.pageCount ?? null,
        createdAt: input.createdAt ?? now,
        capturedAt: input.capturedAt ?? now,
        modifiedAt: input.modifiedAt ?? now,
        lastKeptAt: input.lastKeptAt ?? now,
        captureBatchId: input.captureBatchId ?? null,
        processingStatus: input.processingStatus ?? 'CAPTURED',
        processingError: input.processingError ?? null,
        understanding: input.understanding ?? null,
        whyUseful: input.whyUseful ?? null,
        topics: input.topics ?? [],
        entities: input.entities ?? [],
        visionText: input.visionText ?? null,
        retrievalHints: input.retrievalHints ?? [],
        aiConfidence: input.aiConfidence ?? null,
        metadata: input.metadata ?? {},
        extractedText: input.extractedText ?? null,
        excerpt: input.excerpt ?? null,
        thumbnailPath: input.thumbnailPath ?? null,
        snapshotPath: input.snapshotPath ?? null,
        faviconPath: input.faviconPath ?? null,
        dominantColor: input.dominantColor ?? null,
        mediaVersion: input.mediaVersion ?? 1,
        parentItemId: input.parentItemId ?? null,
        userOverrides: input.userOverrides ?? {},
        isMissing: input.isMissing ?? false,
        missingCheckedAt: input.missingCheckedAt ?? null,
        deletedAt: input.deletedAt ?? null
      }
      db.transaction(() => {
        items.insert(item)
        emit('item.created', [item.id])
      })
      return item
    },
    get,
    find: (id) => items.get(id),
    list(request) {
      if (request.view === 'collection' && !request.collectionId) {
        throw new KaError('VALIDATION', 'Which collection?')
      }
      const query = {
        view: request.view,
        ...(request.collectionId !== undefined ? { collectionId: request.collectionId } : {}),
        ...(request.types !== undefined ? { types: request.types } : {}),
        ...(request.sort !== undefined ? { sort: request.sort } : {}),
        ...(request.limit !== undefined ? { limit: request.limit } : {}),
        ...(request.offset !== undefined ? { offset: request.offset } : {})
      }
      return items.summaries(items.list(query))
    },
    summary: (id) => items.summary(id),
    summaries: (list) => items.summaries(list),
    detail,
    updateByUser(id, patch) {
      db.transaction(() => {
        const item = get(id)
        const now = clock.nowIso()
        const before: Partial<Item> = { userOverrides: item.userOverrides }
        const update: Partial<Item> = { modifiedAt: now }
        const overrides = { ...item.userOverrides }
        if (patch.title !== undefined) {
          const title = patch.title.trim()
          if (title.length === 0) throw new KaError('VALIDATION', 'A title is needed.')
          before.title = item.title
          update.title = title
          overrides.title = true
        }
        if (patch.understanding !== undefined) {
          before.understanding = item.understanding
          update.understanding = patch.understanding.trim() || null
          overrides.understanding = true
        }
        if (patch.whyUseful !== undefined) {
          before.whyUseful = item.whyUseful
          update.whyUseful = patch.whyUseful.trim() || null
          overrides.whyUseful = true
        }
        if (Object.keys(update).length === 1) return
        update.userOverrides = overrides
        items.update(id, update)
        audit.record({
          actor: 'user',
          action: AUDIT_ACTIONS.updateItem,
          entity: 'item',
          entityId: id,
          before,
          after: { ...update }
        })
        pipeline.enqueueFrom({ ...item, ...update }, 'index')
        emit('item.updated', [id])
      })
      return detail(id)
    },
    applyUnderstanding(id, understanding, opts = {}) {
      return db.transaction(() => {
        const item = get(id)
        const now = clock.nowIso()
        const skipped: UserOverridableField[] = []
        const before: Partial<Item> = {}
        const update: Partial<Item> = { modifiedAt: now }
        const values: Record<UserOverridableField, Item[UserOverridableField]> = {
          title: understanding.title.trim() || item.title,
          understanding: understanding.summary,
          whyUseful: understanding.whyUseful,
          kind: understanding.kind,
          topics: understanding.topics,
          entities: understanding.entities
        }
        for (const field of OVERRIDABLE) {
          if (item.userOverrides[field]) {
            skipped.push(field)
            continue
          }
          ;(before as Record<string, unknown>)[field] = item[field]
          ;(update as Record<string, unknown>)[field] = values[field]
        }
        before.visionText = item.visionText
        before.retrievalHints = item.retrievalHints
        before.aiConfidence = item.aiConfidence
        const vision = [understanding.visualDescription, understanding.visibleText]
          .filter((s) => s && s.trim())
          .join('\n\n')
        update.visionText = vision.length > 0 ? vision : null
        update.retrievalHints = understanding.retrievalHints
        update.aiConfidence = understanding.confidence
        items.update(id, update)
        audit.record({
          actor: opts.actor ?? 'agent',
          action: AUDIT_ACTIONS.updateUnderstanding,
          entity: 'item',
          entityId: id,
          before,
          after: { ...update },
          agentRunId: opts.agentRunId ?? null
        })
        emit('item.updated', [id])
        return { item: get(id), skippedFields: skipped }
      })
    },
    trash(idList) {
      if (idList.length === 0) return
      db.transaction(() => {
        const now = clock.nowIso()
        const existing = items.getMany(idList).filter((i) => !i.deletedAt)
        if (existing.length === 0) return
        const targetIds = existing.map((i) => i.id)
        pipeline.cancelForItems(targetIds)
        items.setDeleted(targetIds, now)
        audit.record({
          actor: 'user',
          action: AUDIT_ACTIONS.trashItem,
          entity: 'item',
          entityId: targetIds[0] as string,
          after: { ids: targetIds }
        })
        emit('item.trashed', targetIds)
      })
    },
    restore(idList) {
      if (idList.length === 0) return
      db.transaction(() => {
        const existing = items.getMany(idList).filter((i) => i.deletedAt)
        if (existing.length === 0) return
        const targetIds = existing.map((i) => i.id)
        items.setDeleted(targetIds, null)
        audit.record({
          actor: 'user',
          action: AUDIT_ACTIONS.restoreItem,
          entity: 'item',
          entityId: targetIds[0] as string,
          after: { ids: targetIds }
        })
        emit('item.restored', targetIds)
      })
    },
    deleteForever(idList) {
      if (idList.length === 0) return []
      return db.transaction(() => {
        const existing = items.getMany(idList)
        const targetIds = existing.map((i) => i.id)
        // Children of a folder go with it.
        for (const item of existing) {
          if (item.type === 'folder') {
            for (const child of items.children(item.id)) {
              if (!targetIds.includes(child.id)) {
                existing.push(child)
                targetIds.push(child.id)
              }
            }
          }
        }
        pipeline.cancelForItems(targetIds)
        items.deleteForever(targetIds)
        emit('item.deleted', targetIds)
        return existing
      })
    },
    cancelProcessing(idList) {
      db.transaction(() => {
        const cancelled = pipeline.cancelForItems(idList)
        const touched: string[] = []
        for (const id of idList) {
          const item = items.get(id)
          // A settled item has nothing to stop; PARTIAL says "kept, we stopped short" without a new status.
          if (!item || isTerminal(item.processingStatus)) continue
          items.update(id, { processingStatus: 'PARTIAL', modifiedAt: clock.nowIso() })
          touched.push(id)
        }
        db.afterCommit(() => {
          for (const job of cancelled) {
            events.emit('job.progress', {
              itemId: job.itemId,
              batchId: job.batchId,
              processingStatus: 'PARTIAL',
              stage: job.stage,
              jobStatus: 'cancelled',
              attempts: job.attempts
            })
          }
        })
        emit('item.updated', touched)
      })
    },
    reprocess(id, from) {
      db.transaction(() => {
        const item = get(id)
        if (item.deletedAt) throw new KaError('CONFLICT', 'Restore it from the Trash first.')
        pipeline.cancelForItems([id])
        const status = statusForReprocess(from)
        const update: Partial<Item> = { processingError: null, modifiedAt: clock.nowIso() }
        if (status) update.processingStatus = status
        items.update(id, update)
        pipeline.enqueueFrom({ ...item, ...update }, from)
        emit('item.updated', [id])
      })
    },
    reprocessAll(from) {
      return db.transaction(() => {
        const all = items.allIds()
        const status = statusForReprocess(from)
        const now = clock.nowIso()
        let count = 0
        for (const id of all) {
          const item = items.get(id)
          if (!item) continue
          pipeline.cancelForItems([id])
          const update: Partial<Item> = { processingError: null, modifiedAt: now }
          if (status) update.processingStatus = status
          items.update(id, update)
          pipeline.enqueueFrom({ ...item, ...update }, from)
          count += 1
        }
        emit('item.updated', all)
        return count
      })
    },
    keptAgain(id) {
      return db.transaction(() => {
        const item = get(id)
        const now = clock.nowIso()
        items.update(id, { lastKeptAt: now })
        audit.record({
          actor: 'user',
          action: AUDIT_ACTIONS.keptAgain,
          entity: 'item',
          entityId: id,
          before: { lastKeptAt: item.lastKeptAt },
          after: { lastKeptAt: now }
        })
        emit('item.updated', [id])
        return { ...item, lastKeptAt: now }
      })
    },
    setMissing(id, isMissing) {
      return db.transaction(() => {
        const item = get(id)
        const now = clock.nowIso()
        if (item.isMissing !== isMissing) {
          items.update(id, { isMissing, missingCheckedAt: now })
          emit('item.updated', [id])
        } else {
          items.update(id, { missingCheckedAt: now })
        }
        return { ...item, isMissing, missingCheckedAt: now }
      })
    }
  }
}
