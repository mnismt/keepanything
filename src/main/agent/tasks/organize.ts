import { COPY, LIMITS } from '../../../shared/constants'
import { normalizeName, relativeTime, tokenize, truncate } from '../../../shared/text'
import type { Collection, Item } from '../../../shared/types'
import {
  buildOrganizeBatchRequest,
  buildOrganizeRequest,
  type CollectionContext,
  type OrganizeCandidate,
  type OrganizeItemContext,
  type OrganizePlan,
  organizePlanSchema
} from '../../ai'
import { isKaError } from '../../core/errors'
import type { Clock, Logger, StageContext, StagePatch } from '../../ports'
import {
  requireItem,
  startTaskRun,
  structuredCall,
  type TaskRun,
  type TaskServices,
  taskServices,
  toAgentUsage
} from './common'

/** Relationships below this confidence are not created. */
export const MIN_RELATIONSHIP_CONFIDENCE = 0.7
/** At most this many new relationships per subject item and run. */
export const MAX_RELATIONSHIPS_PER_ITEM = 5
/** Names the brief forbids (single topic words and generic buckets). */
export const BAD_COLLECTION_NAMES = new Set(
  [
    'technology',
    'websites',
    'website',
    'software',
    'internet',
    'articles',
    'article',
    'design',
    'misc',
    'miscellaneous',
    'links',
    'files',
    'images',
    'other',
    'stuff',
    'things',
    'notes',
    'research',
    'ai',
    'tools'
  ].map(normalizeName)
)
/** Organize batches between consolidate sweeps. */
export const CONSOLIDATE_EVERY_BATCHES = 3
/** Sweep regardless of the counter above this many collections. */
export const CONSOLIDATE_COLLECTION_THRESHOLD = 12

const NAME_STOPWORDS = new Set(['the', 'and', 'of', 'for', 'a', 'an', 'to', 'in', 'on', 'my', 'stuff', 'things'])

/** Token-set Jaccard similarity between two collection names (0..1). */
export function nameSimilarity(a: string, b: string): number {
  const ta = new Set(tokenize(a).filter((t) => !NAME_STOPWORDS.has(t)))
  const tb = new Set(tokenize(b).filter((t) => !NAME_STOPWORDS.has(t)))
  if (ta.size === 0 || tb.size === 0) return normalizeName(a) === normalizeName(b) ? 1 : 0
  let shared = 0
  for (const t of ta) if (tb.has(t)) shared++
  return shared / (ta.size + tb.size - shared)
}

/** Why a proposed collection name is not acceptable, or null when fine. */
export function collectionNameProblem(name: string): string | null {
  const key = normalizeName(name)
  if (key.length === 0) return 'empty name'
  if (BAD_COLLECTION_NAMES.has(key)) return `"${name}" is a generic bucket`
  if (key.split(' ').length < 2) return `"${name}" is a single word`
  return null
}

export interface PlanOutcome {
  relationshipIds: string[]
  collectionIds: string[]
  /** Human-readable notes on what was rejected and why (logs, tests). */
  rejected: string[]
}

export interface PlanScope {
  subjects: readonly Item[]
  /** Ids the model was shown besides the subjects (candidates, collection members). */
  candidateIds: ReadonlySet<string>
  services: TaskServices
  run: TaskRun
  clock: Clock
  logger: Logger
}

/** Apply the relationship / collection parts of a plan conservatively. Never throws for a bad entry. */
export function applyPlan(
  plan: Pick<OrganizePlan, 'relationships' | 'addToCollections' | 'newCollections'>,
  scope: PlanScope
): PlanOutcome {
  const { services, run } = scope
  const { repos } = services
  const outcome: PlanOutcome = { relationshipIds: [], collectionIds: [], rejected: [] }
  const subjectIds = new Set(scope.subjects.map((s) => s.id))
  const known = (id: string): boolean => subjectIds.has(id) || scope.candidateIds.has(id)
  const titleOf = (id: string): string => repos.items.get(id)?.title ?? id
  const reject = (why: string): void => {
    outcome.rejected.push(why)
    scope.logger.debug('organize.rejected', { why })
  }

  // Relationships ----------------------------------------------------------
  const perItem = new Map<string, number>()
  const pairs = new Set<string>()
  const pairKey = (a: string, b: string): string => (a < b ? `${a}:${b}` : `${b}:${a}`)
  if (services.relationships) {
    const sorted = [...plan.relationships].sort((a, b) => b.confidence - a.confidence)
    for (const r of sorted) {
      if (r.sourceId === r.targetId) continue
      // One edge per pair and run; pairs that are already connected are left alone.
      if (pairs.has(pairKey(r.sourceId, r.targetId))) {
        reject(`relationship ${r.sourceId}→${r.targetId}: pair already handled in this plan`)
        continue
      }
      if (repos.relationships.between(r.sourceId, r.targetId).length > 0) {
        reject(`relationship ${r.sourceId}→${r.targetId}: already connected`)
        continue
      }
      if (!known(r.sourceId) || !known(r.targetId)) {
        reject(`relationship ${r.sourceId}→${r.targetId}: unknown item`)
        continue
      }
      if (!subjectIds.has(r.sourceId) && !subjectIds.has(r.targetId)) {
        reject(`relationship ${r.sourceId}→${r.targetId}: neither side is being organized`)
        continue
      }
      if (r.confidence < MIN_RELATIONSHIP_CONFIDENCE) {
        reject(
          `relationship ${r.sourceId}→${r.targetId}: confidence ${r.confidence} below ${MIN_RELATIONSHIP_CONFIDENCE}`
        )
        continue
      }
      const subject = subjectIds.has(r.sourceId) ? r.sourceId : r.targetId
      if ((perItem.get(subject) ?? 0) >= MAX_RELATIONSHIPS_PER_ITEM) {
        reject(`relationship ${r.sourceId}→${r.targetId}: cap reached`)
        continue
      }
      if (services.relationships.isSuppressed(r.sourceId, r.targetId)) {
        reject(`relationship ${r.sourceId}→${r.targetId}: removed by the person before`)
        continue
      }
      try {
        const created = services.relationships.create({
          sourceId: r.sourceId,
          targetId: r.targetId,
          type: r.type,
          description: r.description,
          confidence: Number(r.confidence.toFixed(2)),
          evidence: r.evidenceQuote ? { itemId: r.targetId, quote: r.evidenceQuote.slice(0, 280) } : null,
          createdBy: 'agent',
          agentRunId: run.id
        })
        outcome.relationshipIds.push(created.id)
        pairs.add(pairKey(r.sourceId, r.targetId))
        perItem.set(subject, (perItem.get(subject) ?? 0) + 1)
        run.step({
          tool: 'create_relationship',
          kind: 'write',
          label: `Related "${titleOf(r.sourceId)}" to "${titleOf(r.targetId)}"`,
          itemIds: [r.sourceId, r.targetId],
          status: 'ok'
        })
      } catch (error) {
        reject(`relationship ${r.sourceId}→${r.targetId}: ${isKaError(error) ? error.message : String(error)}`)
      }
    }
  }

  // Memberships in existing collections ---------------------------------------
  if (services.collections) {
    const collections = services.collections
    const byId = new Map(repos.collections.list().map((c) => [c.id, c]))
    const additions = new Map<string, { itemId: string; confidence: number; reason: string }[]>()
    for (const a of plan.addToCollections) {
      const collection = byId.get(a.collectionId)
      if (!collection) {
        reject(`add ${a.itemId}: unknown collection ${a.collectionId}`)
        continue
      }
      if (!subjectIds.has(a.itemId) && !scope.candidateIds.has(a.itemId)) {
        reject(`add ${a.itemId} to ${collection.name}: unknown item`)
        continue
      }
      if (a.confidence < LIMITS.minCollectionConfidence) {
        reject(
          `add ${a.itemId} to ${collection.name}: confidence ${a.confidence} below ${LIMITS.minCollectionConfidence}`
        )
        continue
      }
      const list = additions.get(collection.id) ?? []
      list.push({ itemId: a.itemId, confidence: Number(a.confidence.toFixed(2)), reason: a.reason })
      additions.set(collection.id, list)
    }

    // New collections: valid name, description, ≥ LIMITS.minNewCollectionMembers members; fold into an existing near-duplicate instead.
    for (const proposal of plan.newCollections) {
      const problem = collectionNameProblem(proposal.name)
      if (problem) {
        reject(`new collection: ${problem}`)
        continue
      }
      const members = proposal.members.filter(
        (m, i, arr) => known(m.itemId) && arr.findIndex((x) => x.itemId === m.itemId) === i
      )
      const similar = [...byId.values()].find(
        (c) =>
          normalizeName(c.name) === normalizeName(proposal.name) ||
          nameSimilarity(c.name, proposal.name) >= LIMITS.collectionNameFold
      )
      if (similar) {
        const list = additions.get(similar.id) ?? []
        for (const m of members)
          list.push({ itemId: m.itemId, confidence: Number(proposal.confidence.toFixed(2)), reason: m.reason })
        additions.set(similar.id, list)
        reject(`new collection "${proposal.name}": folded into existing "${similar.name}"`)
        continue
      }
      if (proposal.description.trim().length < LIMITS.minCollectionDescriptionChars) {
        reject(`new collection "${proposal.name}": description too short`)
        continue
      }
      if (proposal.confidence < LIMITS.minCollectionConfidence) {
        reject(`new collection "${proposal.name}": confidence ${proposal.confidence}`)
        continue
      }
      const nameKey = normalizeName(proposal.name)
      const eligible = members.filter(
        (m) => !repos.suppressions.has('collection_member', `name:${nameKey}:${m.itemId}`) && repos.items.get(m.itemId)
      )
      if (eligible.length < LIMITS.minNewCollectionMembers) {
        reject(`new collection "${proposal.name}": only ${eligible.length} eligible members`)
        continue
      }
      try {
        const created = collections.create({
          name: proposal.name,
          description: proposal.description,
          createdBy: 'agent',
          agentRunId: run.id
        })
        byId.set(created.id, created)
        const result = collections.addItems(
          created.id,
          eligible.map((m) => ({
            itemId: m.itemId,
            confidence: Number(proposal.confidence.toFixed(2)),
            reason: m.reason
          })),
          { actor: 'agent', agentRunId: run.id }
        )
        outcome.collectionIds.push(created.id)
        run.step({
          tool: 'create_collection',
          kind: 'write',
          label: `Created "${created.name}" with ${result.added.length} items`,
          itemIds: result.added,
          status: 'ok'
        })
      } catch (error) {
        reject(`new collection "${proposal.name}": ${isKaError(error) ? error.message : String(error)}`)
      }
    }

    for (const [collectionId, list] of additions) {
      const collection = byId.get(collectionId)
      if (!collection) continue
      try {
        const result = collections.addItems(collectionId, list, { actor: 'agent', agentRunId: run.id })
        for (const skipped of result.skipped) reject(`add ${skipped.itemId} to ${collection.name}: ${skipped.reason}`)
        if (result.added.length > 0) {
          if (!outcome.collectionIds.includes(collectionId)) outcome.collectionIds.push(collectionId)
          run.step({
            tool: 'add_to_collection',
            kind: 'write',
            label:
              result.added.length === 1
                ? `Added "${titleOf(result.added[0] as string)}" to "${collection.name}"`
                : `Added ${result.added.length} items to "${collection.name}"`,
            itemIds: result.added,
            status: 'ok'
          })
        }
      } catch (error) {
        reject(`add to ${collection.name}: ${isKaError(error) ? error.message : String(error)}`)
      }
    }
  }
  return outcome
}

function itemContext(item: Item, nowIso: string): OrganizeItemContext {
  return {
    id: item.id,
    title: item.title,
    type: item.type,
    subtype: item.subtype,
    kind: item.kind,
    domain: item.domain,
    capturedAgo: relativeTime(item.capturedAt, nowIso),
    topics: item.topics.slice(0, 6),
    entities: item.entities.slice(0, 8),
    understanding: item.understanding ? truncate(item.understanding, 280) : null,
    whyUseful: item.whyUseful ? truncate(item.whyUseful, 200) : null
  }
}

/** Existing collections for the prompt: centroid-ranked for the subjects, then the rest, ≤ 30. */
export async function collectionContexts(
  services: TaskServices,
  subjectIds: readonly string[]
): Promise<CollectionContext[]> {
  const summaries = services.repos.collections.listSummaries()
  if (summaries.length === 0) return []
  const scored = new Map<string, { cosine: number; nearest: { id: string; title: string }[] }>()
  if (services.retrieval) {
    for (const id of subjectIds.slice(0, 8)) {
      for (const c of await services.retrieval.collectionCandidates(id, 5)) {
        const current = scored.get(c.collection.id)
        if (!current || c.cosine > current.cosine) {
          scored.set(c.collection.id, {
            cosine: c.cosine,
            nearest: c.nearestMembers.map((m) => ({ id: m.id, title: m.title }))
          })
        }
      }
    }
  }
  const out: CollectionContext[] = summaries.map((c) => {
    const ctx: CollectionContext = {
      id: c.id,
      name: c.name,
      description: c.description,
      count: c.count,
      createdBy: c.createdBy
    }
    const score = scored.get(c.id)
    if (score) {
      ctx.cosine = Number(score.cosine.toFixed(2))
      ctx.nearestMembers = score.nearest
    }
    return ctx
  })
  out.sort((a, b) => (b.cosine ?? -1) - (a.cosine ?? -1) || a.name.localeCompare(b.name))
  return out.slice(0, 30)
}

/** Sentences about what the person established for these items (ground truth). */
export function userFacts(services: TaskServices, subjects: readonly Item[]): string[] {
  const { repos } = services
  const out: string[] = []
  for (const item of subjects) {
    for (const m of repos.collections.membershipsForItem(item.id)) {
      if (m.addedBy !== 'user') continue
      const c = repos.collections.get(m.collectionId)
      if (c) out.push(`"${item.title}" is in the collection "${c.name}" (the person put it there).`)
    }
    for (const r of repos.relationships.forItem(item.id)) {
      if (r.createdBy !== 'user') continue
      const otherId = r.sourceItemId === item.id ? r.targetItemId : r.sourceItemId
      const other = repos.items.get(otherId)
      if (other) out.push(`"${item.title}" and "${other.title}" are connected (${r.type}, made by the person).`)
    }
  }
  return out.slice(0, 20)
}

/** Sentences about facts the person removed (never propose again). */
export function suppressedFacts(services: TaskServices, subjects: readonly Item[]): string[] {
  const { repos } = services
  const out: string[] = []
  const ids = new Set(subjects.map((s) => s.id))
  const titleOf = (id: string): string => repos.items.get(id)?.title ?? id
  for (const key of repos.suppressions.keys('relationship')) {
    const [a, b] = key.split(':')
    if (!a || !b || (!ids.has(a) && !ids.has(b))) continue
    out.push(`Do not connect "${titleOf(a)}" and "${titleOf(b)}".`)
  }
  for (const key of repos.suppressions.keys('collection_member')) {
    if (key.startsWith('name:')) {
      const rest = key.slice('name:'.length)
      const at = rest.lastIndexOf(':')
      const nameKey = rest.slice(0, at)
      const itemId = rest.slice(at + 1)
      if (ids.has(itemId)) out.push(`Do not add "${titleOf(itemId)}" to a collection named "${nameKey}".`)
      continue
    }
    const [collectionId, itemId] = key.split(':')
    if (!collectionId || !itemId || !ids.has(itemId)) continue
    const c = repos.collections.get(collectionId)
    if (c) out.push(`Do not add "${titleOf(itemId)}" to "${c.name}".`)
  }
  return out.slice(0, 20)
}

function siblingCandidates(services: TaskServices, item: Item, nowIso: string): OrganizeCandidate[] {
  if (!item.captureBatchId) return []
  return services.repos.items
    .siblings(item.captureBatchId)
    .filter((s) => s.id !== item.id && s.type !== 'note')
    .slice(0, 12)
    .map((s) => ({
      id: s.id,
      title: s.title,
      type: s.type,
      kind: s.kind,
      domain: s.domain,
      capturedAgo: relativeTime(s.capturedAt, nowIso),
      topics: s.topics.slice(0, 4),
      understanding: s.understanding ? truncate(s.understanding, 140) : null,
      flags: ['same_batch']
    }))
}

/** Merge organize `understandingPatches` for `item` into a stage patch (union, capped). */
export function understandingPatchFor(item: Item, plan: OrganizePlan): StagePatch['item'] | undefined {
  const patches = plan.understandingPatches.filter((p) => p.itemId === item.id)
  if (patches.length === 0) return undefined
  const union = (current: string[], extra: string[] | undefined, max: number): string[] => {
    const seen = new Set(current.map((s) => s.toLowerCase()))
    const out = [...current]
    for (const value of extra ?? []) {
      if (seen.has(value.toLowerCase())) continue
      seen.add(value.toLowerCase())
      out.push(value)
      if (out.length >= max) break
    }
    return out
  }
  const patch: NonNullable<StagePatch['item']> = {}
  for (const p of patches) {
    if (p.topics && !item.userOverrides.topics) patch.topics = union(patch.topics ?? item.topics, p.topics, 6)
    if (p.entities && !item.userOverrides.entities)
      patch.entities = union(patch.entities ?? item.entities, p.entities, 12)
    if (p.retrievalHints) patch.retrievalHints = union(patch.retrievalHints ?? item.retrievalHints, p.retrievalHints, 6)
  }
  return Object.keys(patch).length > 0 ? patch : undefined
}

const NOTHING_RELATED = 'Kept on its own for now; nothing else in the library is about this yet.'

/** Near-duplicate rule: same type and cosine ≥ 0.92, or same canonical title + domain. */
export function isNearDuplicate(item: Item, other: Item, cosine: number | undefined): boolean {
  if (item.type === other.type && (cosine ?? 0) >= LIMITS.nearDuplicateCosine) return true
  return (
    normalizeName(item.title) === normalizeName(other.title) &&
    (item.domain ?? '') === (other.domain ?? '') &&
    item.type === other.type
  )
}

export async function runRelate(ctx: StageContext): Promise<StagePatch> {
  const item = requireItem(ctx)
  if (item.type === 'note') return { outcome: 'ok' }
  const s = taskServices(ctx.deps)
  const logger = ctx.logger.child({ task: 'relate' })
  const nowIso = ctx.clock.nowIso()
  const run = startTaskRun(s, ctx.clock, { task: 'organize', itemId: item.id })
  try {
    let candidates = s.retrieval
      ? await s.retrieval.candidatesFor(item.id, { k: 12 })
      : siblingCandidates(s, item, nowIso)
    run.step({
      tool: 'find_candidates',
      kind: 'search',
      label:
        candidates.length === 0 ? 'Looking for related things' : `Comparing with ${candidates.length} related things`,
      itemIds: candidates.map((c) => c.id),
      status: 'ok'
    })

    const relationshipIds: string[] = []
    const candidateItems = new Map(s.repos.items.getMany(candidates.map((c) => c.id)).map((i) => [i.id, i]))
    if (s.relationships) {
      const rest: OrganizeCandidate[] = []
      for (const c of candidates) {
        const other = candidateItems.get(c.id)
        if (other && isNearDuplicate(item, other, c.cosine) && !s.relationships.isSuppressed(item.id, other.id)) {
          try {
            const created = s.relationships.create({
              sourceId: item.id,
              targetId: other.id,
              type: 'duplicate_of',
              description: 'Looks like the same thing kept twice.',
              confidence: 0.9,
              createdBy: 'agent',
              agentRunId: run.id
            })
            relationshipIds.push(created.id)
            run.step({
              tool: 'create_relationship',
              kind: 'write',
              label: `Marked as a duplicate of "${other.title}"`,
              itemIds: [item.id, other.id],
              status: 'ok'
            })
            continue
          } catch (error) {
            logger.debug('duplicate rule skipped', { error })
          }
        }
        rest.push(c)
      }
      candidates = rest
    }

    const collections = await collectionContexts(s, [item.id])
    if (candidates.length === 0 && collections.length === 0) {
      run.succeed(
        { task: 'organize', itemId: item.id, relationshipIds, collectionIds: [], summary: NOTHING_RELATED },
        null
      )
      return { outcome: 'ok', message: NOTHING_RELATED }
    }

    const input = {
      item: itemContext(item, nowIso),
      collections,
      userFacts: userFacts(s, [item]),
      suppressed: suppressedFacts(s, [item])
    }
    const outcome = await structuredCall(
      s.ai,
      organizePlanSchema,
      (n) => buildOrganizeRequest({ ...input, candidates: candidates.slice(0, n) }, ctx.signal),
      { textBudget: Math.max(1, candidates.length), minBudget: 1, logger }
    )
    if (!outcome.ok) {
      run.fail(outcome.message, toAgentUsage(outcome.usage, 1))
      return { outcome: 'failed', message: COPY.stillFiguring, error: `relate: ${outcome.failure}: ${outcome.message}` }
    }
    const plan = outcome.value
    const applied = applyPlan(plan, {
      subjects: [item],
      candidateIds: new Set(candidates.map((c) => c.id)),
      services: s,
      run,
      clock: ctx.clock,
      logger
    })
    relationshipIds.push(...applied.relationshipIds)
    run.succeed(
      {
        task: 'organize',
        itemId: item.id,
        relationshipIds,
        collectionIds: applied.collectionIds,
        summary: plan.summary
      },
      toAgentUsage(outcome.usage, 1)
    )
    logger.info('related', {
      itemId: item.id,
      relationships: relationshipIds.length,
      collections: applied.collectionIds.length,
      rejected: applied.rejected.length,
      promptTokens: outcome.usage.promptTokens,
      latencyMs: outcome.usage.latencyMs
    })
    const patch: StagePatch = { outcome: 'ok', message: plan.summary }
    const itemPatch = understandingPatchFor(item, plan)
    if (itemPatch) patch.item = itemPatch
    return patch
  } catch (error) {
    run.fail(isKaError(error) ? error.message : COPY.stillFiguring)
    throw error
  }
}

let batchesSinceConsolidate = 0

/** Reset the consolidate rate limiter (tests). */
export function resetConsolidateCounter(): void {
  batchesSinceConsolidate = 0
}

/** Enqueue a `consolidate` sweep every N batches or when the library has many collections. */
export function maybeScheduleConsolidate(services: TaskServices, batchId: string, logger: Logger): boolean {
  batchesSinceConsolidate += 1
  const many = services.repos.collections.list().length > CONSOLIDATE_COLLECTION_THRESHOLD
  if (batchesSinceConsolidate < CONSOLIDATE_EVERY_BATCHES && !many) return false
  if (!services.queue) return false
  if (services.repos.jobs.activeForBatch(batchId, 'consolidate')) return false
  const job = services.queue.enqueue({ itemId: null, batchId, stage: 'consolidate' })
  if (job) {
    batchesSinceConsolidate = 0
    logger.info('consolidate scheduled', { batchId, jobId: job.id, many })
  }
  return job !== null
}

/** Siblings of a batch that reached the relate step. */
export function batchSubjects(services: TaskServices, batchId: string): Item[] {
  return services.repos.items
    .siblings(batchId)
    .filter((s) => s.type !== 'note' && !s.deletedAt)
    .filter(
      (s) =>
        services.repos.jobs.finishedStages(s.id).has('index') ||
        s.processingStatus === 'RELATING' ||
        s.processingStatus === 'READY' ||
        s.processingStatus === 'PARTIAL'
    )
}

export async function runOrganizeBatch(ctx: StageContext): Promise<StagePatch> {
  const batchId = ctx.batchId
  if (!batchId) return { outcome: 'ok' }
  const s = taskServices(ctx.deps)
  const logger = ctx.logger.child({ task: 'organize_batch' })
  const subjects = batchSubjects(s, batchId)
  if (subjects.length === 0) return { outcome: 'ok' }
  const nowIso = ctx.clock.nowIso()
  const run = startTaskRun(s, ctx.clock, { task: 'organize_batch', batchId })
  try {
    const subjectIds = new Set(subjects.map((i) => i.id))
    const candidates: OrganizeCandidate[] = []
    const seen = new Set<string>()
    for (const item of subjects) {
      const own = s.retrieval ? await s.retrieval.candidatesFor(item.id, { k: 8 }) : []
      for (const c of own) {
        if (subjectIds.has(c.id)) continue
        const key = `${c.id}:${item.id}`
        if (seen.has(key)) continue
        seen.add(key)
        candidates.push({ ...c, forItemId: item.id })
      }
    }
    run.step({
      tool: 'find_candidates',
      kind: 'search',
      label: `Comparing ${subjects.length} new items with ${candidates.length} related things`,
      itemIds: subjects.map((i) => i.id),
      status: 'ok'
    })
    const collections = await collectionContexts(
      s,
      subjects.map((i) => i.id)
    )
    const input = {
      items: subjects.map((i) => itemContext(i, nowIso)),
      collections,
      userFacts: userFacts(s, subjects),
      suppressed: suppressedFacts(s, subjects)
    }
    const outcome = await structuredCall(
      s.ai,
      organizePlanSchema,
      (n) => buildOrganizeBatchRequest({ ...input, candidates: candidates.slice(0, n) }, ctx.signal),
      { textBudget: Math.max(1, candidates.length), minBudget: 1, logger }
    )
    if (!outcome.ok) {
      run.fail(outcome.message, toAgentUsage(outcome.usage, 1))
      return {
        outcome: 'failed',
        message: COPY.stillFiguring,
        error: `organize_batch: ${outcome.failure}: ${outcome.message}`
      }
    }
    const plan = outcome.value
    const applied = applyPlan(plan, {
      subjects,
      candidateIds: new Set(candidates.map((c) => c.id)),
      services: s,
      run,
      clock: ctx.clock,
      logger
    })
    run.succeed(
      {
        task: 'organize_batch',
        batchId,
        itemIds: subjects.map((i) => i.id),
        relationshipIds: applied.relationshipIds,
        collectionIds: applied.collectionIds,
        summary: plan.summary
      },
      toAgentUsage(outcome.usage, 1)
    )
    logger.info('organized batch', {
      batchId,
      items: subjects.length,
      relationships: applied.relationshipIds.length,
      collections: applied.collectionIds.length,
      rejected: applied.rejected,
      promptTokens: outcome.usage.promptTokens,
      latencyMs: outcome.usage.latencyMs
    })
    maybeScheduleConsolidate(s, batchId, logger)
    return { outcome: 'ok', message: plan.summary }
  } catch (error) {
    run.fail(isKaError(error) ? error.message : COPY.stillFiguring)
    throw error
  }
}

/** Collections created by the agent (the only ones a sweep may rename or merge). */
export function agentCollections(collections: readonly Collection[]): Collection[] {
  return collections.filter((c) => c.createdBy === 'agent')
}
