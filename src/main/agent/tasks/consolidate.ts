import { COPY } from '../../../shared/constants'
import { relativeTime, truncate } from '../../../shared/text'
import type { Collection, Item } from '../../../shared/types'
import {
  buildConsolidateRequest,
  type ConsolidateCollection,
  type ConsolidateItem,
  type ConsolidatePlan,
  consolidatePlanSchema
} from '../../ai'
import { isKaError } from '../../core/errors'
import type { Logger, StageContext, StagePatch } from '../../ports'
import { startTaskRun, structuredCall, type TaskRun, type TaskServices, taskServices, toAgentUsage } from './common'
import { applyPlan, collectionNameProblem, nameSimilarity, suppressedFacts } from './organize'

/** Two agent collections are near-duplicates when their names or members overlap this much. */
export const MERGE_NAME_SIMILARITY = 0.5
export const MERGE_MEMBER_OVERLAP = 0.5

/** Items shown to the sweep at most. */
const MAX_ITEMS = 120

export function canMerge(
  from: Collection,
  into: Collection,
  fromMembers: readonly string[],
  intoMembers: readonly string[]
): boolean {
  if (from.id === into.id) return false
  if (from.createdBy !== 'agent' || into.createdBy !== 'agent') return false
  if (nameSimilarity(from.name, into.name) >= MERGE_NAME_SIMILARITY) return true
  if (fromMembers.length === 0) return false
  const intoSet = new Set(intoMembers)
  const shared = fromMembers.filter((id) => intoSet.has(id)).length
  return shared / fromMembers.length >= MERGE_MEMBER_OVERLAP
}

interface SweepContext {
  collections: ConsolidateCollection[]
  items: ConsolidateItem[]
  itemIds: Set<string>
  subjects: Item[]
}

function gather(services: TaskServices, batchId: string | undefined, nowIso: string): SweepContext {
  const { repos } = services
  const summaries = repos.collections.listSummaries()
  const membersOf = new Map<string, string[]>()
  const collections: ConsolidateCollection[] = summaries.map((c) => {
    const ids = repos.collections.members(c.id).map((m) => m.itemId)
    membersOf.set(c.id, ids)
    const members = repos.items
      .getMany(ids.slice(0, 30))
      .filter((i) => !i.deletedAt)
      .map((i) => ({ id: i.id, title: i.title, kind: i.kind }))
    return {
      id: c.id,
      name: c.name,
      description: c.description,
      count: c.count,
      createdBy: c.createdBy,
      members
    }
  })
  const itemIds = new Set<string>()
  if (batchId) for (const s of repos.items.siblings(batchId)) if (s.type !== 'note') itemIds.add(s.id)
  for (const c of summaries) if (c.createdBy === 'agent') for (const id of membersOf.get(c.id) ?? []) itemIds.add(id)
  for (const item of repos.items.list({ view: 'library', limit: 40 })) if (item.type !== 'note') itemIds.add(item.id)
  const subjects = repos.items.getMany([...itemIds].slice(0, MAX_ITEMS)).filter((i) => !i.deletedAt)
  const collectionIdsOf = (id: string): string[] => repos.collections.membershipsForItem(id).map((m) => m.collectionId)
  const items: ConsolidateItem[] = subjects.map((i) => ({
    id: i.id,
    title: i.title,
    kind: i.kind,
    topics: i.topics.slice(0, 4),
    understanding: i.understanding ? truncate(i.understanding, 140) : null,
    collectionIds: collectionIdsOf(i.id),
    capturedAgo: relativeTime(i.capturedAt, nowIso)
  }))
  return { collections, items, itemIds: new Set(subjects.map((s) => s.id)), subjects }
}

function applyRenames(plan: ConsolidatePlan, services: TaskServices, run: TaskRun, logger: Logger): string[] {
  const renamed: string[] = []
  if (!services.collections) return renamed
  for (const r of plan.renames) {
    const current = services.repos.collections.get(r.collectionId)
    if (!current || current.createdBy !== 'agent') continue
    if (collectionNameProblem(r.name)) continue
    try {
      services.collections.rename(r.collectionId, r.name, r.description, { actor: 'agent', agentRunId: run.id })
      renamed.push(r.collectionId)
      run.step({
        tool: 'rename_collection',
        kind: 'write',
        label: `Renamed "${current.name}" to "${r.name}"`,
        status: 'ok'
      })
    } catch (error) {
      logger.debug('rename skipped', { collectionId: r.collectionId, error })
    }
  }
  return renamed
}

function applyMerges(plan: ConsolidatePlan, services: TaskServices, run: TaskRun, logger: Logger): string[] {
  const touched: string[] = []
  if (!services.collections) return touched
  const { repos } = services
  for (const m of plan.merges) {
    const from = repos.collections.get(m.fromCollectionId)
    const into = repos.collections.get(m.intoCollectionId)
    if (!from || !into) continue
    const fromMembers = repos.collections.members(from.id)
    const intoMembers = repos.collections.members(into.id).map((x) => x.itemId)
    if (
      !canMerge(
        from,
        into,
        fromMembers.map((x) => x.itemId),
        intoMembers
      )
    ) {
      logger.debug('merge rejected: not a near-duplicate', { from: from.name, into: into.name })
      continue
    }
    try {
      services.collections.addItems(
        into.id,
        fromMembers.map((x) => ({ itemId: x.itemId, confidence: x.confidence, reason: x.reason ?? m.reason })),
        { actor: 'agent', agentRunId: run.id }
      )
      services.collections.delete(from.id, { actor: 'agent' })
      touched.push(into.id)
      run.step({
        tool: 'merge_collections',
        kind: 'write',
        label: `Merged "${from.name}" into "${into.name}"`,
        itemIds: fromMembers.map((x) => x.itemId),
        status: 'ok'
      })
    } catch (error) {
      logger.debug('merge skipped', { from: from.name, into: into.name, error })
    }
  }
  return touched
}

const NOTHING = 'Nothing to tidy up.'

export async function runConsolidate(ctx: StageContext): Promise<StagePatch> {
  const s = taskServices(ctx.deps)
  const logger = ctx.logger.child({ task: 'consolidate' })
  const nowIso = ctx.clock.nowIso()
  const sweep = gather(s, ctx.batchId, nowIso)
  if (sweep.collections.length === 0) return { outcome: 'ok', message: NOTHING }
  const run = startTaskRun(s, ctx.clock, { task: 'consolidate', batchId: ctx.batchId ?? null })
  try {
    run.step({
      tool: 'inspect_collections',
      kind: 'inspect',
      label: `Reviewing ${sweep.collections.length} collections`,
      status: 'ok'
    })
    const suppressed = suppressedFacts(s, sweep.subjects)
    const outcome = await structuredCall(
      s.ai,
      consolidatePlanSchema,
      (n) =>
        buildConsolidateRequest(
          { collections: sweep.collections, items: sweep.items.slice(0, n), suppressed },
          ctx.signal
        ),
      { textBudget: Math.max(1, sweep.items.length), minBudget: 10, logger }
    )
    if (!outcome.ok) {
      run.fail(outcome.message, toAgentUsage(outcome.usage, 1))
      return {
        outcome: 'failed',
        message: COPY.stillFiguring,
        error: `consolidate: ${outcome.failure}: ${outcome.message}`
      }
    }
    const plan = outcome.value
    const renamed = applyRenames(plan, s, run, logger)
    const merged = applyMerges(plan, s, run, logger)
    const applied = applyPlan(plan, {
      subjects: sweep.subjects,
      candidateIds: sweep.itemIds,
      services: s,
      run,
      clock: ctx.clock,
      logger
    })
    const collectionIds = [...new Set([...merged, ...applied.collectionIds])]
    run.succeed(
      {
        task: 'consolidate',
        renamedCollectionIds: renamed,
        collectionIds,
        relationshipIds: applied.relationshipIds,
        summary: plan.summary
      },
      toAgentUsage(outcome.usage, 1)
    )
    logger.info('consolidated', {
      renamed: renamed.length,
      merged: merged.length,
      collections: collectionIds.length,
      relationships: applied.relationshipIds.length,
      rejected: applied.rejected,
      promptTokens: outcome.usage.promptTokens,
      latencyMs: outcome.usage.latencyMs
    })
    return { outcome: 'ok', message: plan.summary }
  } catch (error) {
    run.fail(isKaError(error) ? error.message : COPY.stillFiguring)
    throw error
  }
}
