import { normalizePair, relationshipLabel, relationshipSuppressionKey } from '../../shared/kinds'
import type {
  Relationship,
  RelationshipCreator,
  RelationshipDirection,
  RelationshipEvidence,
  RelationshipType
} from '../../shared/types'
import type { Clock, EventBus } from '../ports'
import type { Db } from '../storage/db'
import type { Repositories } from '../storage/repositories'
import { AUDIT_ACTIONS, type AuditService } from './audit'
import { KaError } from './errors'
import { type IdGenerator, uuid } from './ids'

export interface CreateRelationshipInput {
  sourceId: string
  targetId: string
  type: RelationshipType
  description?: string | null
  confidence?: number | null
  evidence?: RelationshipEvidence | null
  createdBy: RelationshipCreator
  agentRunId?: string | null
}

/** A relationship as seen from one item. */
export interface RelationshipView {
  relationship: Relationship
  direction: RelationshipDirection
  label: string
  otherId: string
}

export interface RelationshipService {
  /**
   * Create an edge. Symmetric types are stored `source < target`. Throws `VALIDATION` for self
   * links, `NOT_FOUND` for unknown items, `CONFLICT` when the edge exists or the pair is suppressed
   * for agent/system actors.
   */
  create(input: CreateRelationshipInput): Relationship
  /** Throws `NOT_FOUND`. */
  get(id: string): Relationship
  /** Remove an edge. A user removal suppresses the pair for the agent. */
  remove(id: string, opts: { actor: RelationshipCreator }): void
  forItem(itemId: string): RelationshipView[]
  isSuppressed(a: string, b: string): boolean
}

export interface RelationshipServiceDeps {
  db: Db
  repos: Repositories
  events: EventBus
  clock: Clock
  audit: AuditService
  ids?: IdGenerator
}

export function createRelationshipService(deps: RelationshipServiceDeps): RelationshipService {
  const { db, repos, events, clock, audit } = deps
  const ids = deps.ids ?? uuid
  const { relationships, suppressions, items } = repos

  const touched = (itemIds: string[]): void => {
    db.afterCommit(() => {
      events.emit('item.updated', {
        reason: 'updated',
        ids: itemIds,
        summaries: items.summaries(items.getMany(itemIds))
      })
    })
  }

  const get = (id: string): Relationship => {
    const r = relationships.get(id)
    if (!r) throw new KaError('NOT_FOUND', "Couldn't find that connection.")
    return r
  }

  const isSuppressed = (a: string, b: string): boolean =>
    suppressions.has('relationship', relationshipSuppressionKey(a, b))

  return {
    create(input) {
      return db.transaction(() => {
        if (input.sourceId === input.targetId) throw new KaError('VALIDATION', "An item can't relate to itself.")
        const [sourceItemId, targetItemId] = normalizePair(input.sourceId, input.targetId, input.type)
        const source = items.get(sourceItemId)
        const target = items.get(targetItemId)
        if (!source || !target || source.deletedAt || target.deletedAt)
          throw new KaError('NOT_FOUND', 'One of those items is gone.')
        if (input.createdBy === 'user') {
          suppressions.remove('relationship', relationshipSuppressionKey(sourceItemId, targetItemId))
        } else if (isSuppressed(sourceItemId, targetItemId)) {
          throw new KaError('CONFLICT', 'The user removed a connection between these items.')
        }
        if (relationships.find(sourceItemId, targetItemId, input.type))
          throw new KaError('CONFLICT', 'Already connected.')
        const relationship: Relationship = {
          id: ids(),
          sourceItemId,
          targetItemId,
          type: input.type,
          description: input.description?.trim() || null,
          confidence: input.confidence ?? null,
          evidence: input.evidence ?? null,
          createdBy: input.createdBy,
          agentRunId: input.agentRunId ?? null,
          createdAt: clock.nowIso()
        }
        relationships.insert(relationship)
        audit.record({
          actor: input.createdBy,
          action: AUDIT_ACTIONS.createRelationship,
          entity: 'relationship',
          entityId: relationship.id,
          after: relationship,
          agentRunId: input.agentRunId ?? null
        })
        touched([sourceItemId, targetItemId])
        return relationship
      })
    },
    get,
    remove(id, opts) {
      db.transaction(() => {
        const r = get(id)
        relationships.delete(id)
        if (opts.actor === 'user') {
          suppressions.add('relationship', relationshipSuppressionKey(r.sourceItemId, r.targetItemId), clock.nowIso())
        }
        audit.record({
          actor: opts.actor,
          action: AUDIT_ACTIONS.removeRelationship,
          entity: 'relationship',
          entityId: id,
          before: r
        })
        touched([r.sourceItemId, r.targetItemId])
      })
    },
    forItem(itemId) {
      return relationships.forItem(itemId).map((relationship) => {
        const direction: RelationshipDirection = relationship.sourceItemId === itemId ? 'out' : 'in'
        return {
          relationship,
          direction,
          label: relationshipLabel(relationship.type, direction),
          otherId: direction === 'out' ? relationship.targetItemId : relationship.sourceItemId
        }
      })
    },
    isSuppressed
  }
}
