/**
 * A `KeepAnythingApi` backed by fixture data, installed when the preload is
 * absent (plain browser, Playwright chromium, screenshot server). Behaviour mirrors main closely
 * enough to exercise every shell flow: list/get/trash/restore, capture (creates items that walk
 * through the pipeline statuses), collections, quick search, an agent run that streams
 * `agent:run` events, settings and jobs.
 */
import type { KeepAnythingApi } from '../../../preload/api'
import type {
  AgentRunEvent,
  IpcChannel,
  IpcEnvelope,
  IpcErrorCode,
  IpcEventMap,
  IpcEventName,
  IpcRequestMap,
  IpcResponseMap
} from '../../../shared/ipc'
import { relationshipLabel } from '../../../shared/kinds'
import { isTerminal } from '../../../shared/status'
import { relativeTime, tokenize } from '../../../shared/text'
import type {
  AgentRunDetail,
  AgentStep,
  CaptureResult,
  CollectionSummary,
  ItemDetail,
  ItemSummary,
  JobProgress,
  ProcessingStatus,
  SearchHit,
  Settings
} from '../../../shared/types'
import {
  FIXTURE_COLLECTIONS,
  FIXTURE_ITEMS,
  FIXTURE_JOBS,
  FIXTURE_RELATIONSHIPS,
  FIXTURE_RUN,
  FIXTURE_SETTINGS,
  SEED_BY_ID,
  svgThumb,
  toItem
} from './mock-fixtures'

type Listener<E extends IpcEventName> = (payload: IpcEventMap[E]) => void

interface MockState {
  items: Map<string, ItemSummary>
  trashed: Set<string>
  collections: Map<string, CollectionSummary>
  membership: Map<string, Set<string>>
  runs: Map<string, AgentRunDetail>
  settings: Settings
  jobs: JobProgress[]
}

const ok = <T>(data: T): IpcEnvelope<T> => ({ ok: true, data })
const fail = <T>(code: IpcErrorCode, message: string): IpcEnvelope<T> => ({ ok: false, error: { code, message } })

let counter = 100
const uid = (prefix: string): string => `${prefix}-${(counter++).toString(36)}`

/** Sequence a new capture walks through, in the mock. */
const PIPELINE: ProcessingStatus[] = ['CAPTURED', 'EXTRACTING', 'EMBEDDING', 'UNDERSTANDING', 'RELATING', 'READY']

export function createMockBridge(): KeepAnythingApi {
  const listeners = new Map<IpcEventName, Set<Listener<IpcEventName>>>()
  const emit = <E extends IpcEventName>(event: E, payload: IpcEventMap[E]): void => {
    const set = listeners.get(event)
    if (!set) return
    for (const l of set) (l as Listener<E>)(payload)
  }

  const state: MockState = {
    items: new Map(FIXTURE_ITEMS.map((i) => [i.id, { ...i }])),
    trashed: new Set(),
    collections: new Map(FIXTURE_COLLECTIONS.map((c) => [c.id, { ...c }])),
    membership: new Map(),
    runs: new Map([[FIXTURE_RUN.id, FIXTURE_RUN]]),
    settings: { ...FIXTURE_SETTINGS },
    jobs: [...FIXTURE_JOBS]
  }
  for (const item of state.items.values()) {
    for (const cid of item.collectionIds) {
      if (!state.membership.has(cid)) state.membership.set(cid, new Set())
      state.membership.get(cid)?.add(item.id)
    }
  }

  const live = (): ItemSummary[] => [...state.items.values()].filter((i) => !state.trashed.has(i.id))

  const collectionSummaries = (): CollectionSummary[] =>
    [...state.collections.values()].map((c) => {
      const ids = [...(state.membership.get(c.id) ?? [])].filter((id) => !state.trashed.has(id))
      const covers = ids
        .map((id) => state.items.get(id)?.thumbnailUrl)
        .filter((u): u is string => Boolean(u))
        .slice(0, 4)
      return { ...c, count: ids.length, coverThumbnailUrls: covers }
    })

  const listItems = (req: IpcRequestMap['items:list']): ItemSummary[] => {
    let rows: ItemSummary[]
    switch (req.view) {
      case 'trash':
        rows = [...state.items.values()].filter((i) => state.trashed.has(i.id))
        break
      case 'links':
        rows = live().filter((i) => i.type === 'url')
        break
      case 'files':
        rows = live().filter((i) => i.type !== 'url' && i.type !== 'note')
        break
      case 'collection': {
        const ids = state.membership.get(req.collectionId ?? '') ?? new Set()
        rows = live().filter((i) => ids.has(i.id))
        break
      }
      default:
        rows = live().filter((i) => !i.parentItemId)
    }
    if (req.types && req.types.length > 0) rows = rows.filter((i) => req.types?.includes(i.type))
    const sort = req.sort ?? 'captured'
    rows.sort((a, b) =>
      sort === 'title'
        ? a.title.localeCompare(b.title)
        : Date.parse(b[sort === 'created' ? 'createdAt' : 'capturedAt']) -
          Date.parse(a[sort === 'created' ? 'createdAt' : 'capturedAt'])
    )
    const offset = req.offset ?? 0
    return rows.slice(offset, req.limit ? offset + req.limit : undefined)
  }

  const detail = (id: string): ItemDetail | null => {
    const summary = state.items.get(id)
    if (!summary) return null
    const relationships = FIXTURE_RELATIONSHIPS.filter((r) => r.sourceItemId === id || r.targetItemId === id)
      .map((r) => {
        const direction = r.sourceItemId === id ? 'out' : 'in'
        const other = state.items.get(direction === 'out' ? r.targetItemId : r.sourceItemId)
        return other
          ? { ...r, direction: direction as 'out' | 'in', label: relationshipLabel(r.type, direction), other }
          : null
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
    const collections = collectionSummaries()
      .filter((c) => state.membership.get(c.id)?.has(id))
      .map((c) => ({
        ...c,
        confidence: c.createdBy === 'agent' ? 0.84 : null,
        reason:
          c.createdBy === 'agent' ? `Related to ${Math.max(1, c.count - 1)} existing items in this collection.` : null,
        addedBy: c.createdBy as 'user' | 'agent',
        agentRunId: c.createdBy === 'agent' ? FIXTURE_RUN.id : null,
        addedAt: summary.capturedAt
      }))
    return {
      item: toItem(summary, SEED_BY_ID.get(id)),
      summary,
      originalUrl: summary.thumbnailUrl,
      relationships,
      collections,
      latestRuns: id === FIXTURE_RUN.itemId ? [FIXTURE_RUN] : []
    }
  }

  /** Create an item and walk it through the pipeline with `jobs:progress` + `items:changed`. */
  const capture = (title: string, type: ItemSummary['type'], extra: Partial<ItemSummary> = {}): ItemSummary => {
    const now = new Date().toISOString()
    const id = uid('it')
    const item: ItemSummary = {
      id,
      type,
      subtype: null,
      kind: null,
      title,
      domain: null,
      url: null,
      thumbnailUrl: null,
      snapshotUrl: null,
      faviconUrl: null,
      dominantColor: null,
      width: null,
      height: null,
      size: null,
      mimeType: null,
      durationMs: null,
      pageCount: null,
      excerpt: null,
      capturedAt: now,
      createdAt: now,
      processingStatus: 'CAPTURED',
      processingError: null,
      understanding: null,
      collectionIds: [],
      childCount: 0,
      childThumbnailUrls: [],
      isMissing: false,
      parentItemId: null,
      ...extra
    }
    state.items.set(id, item)
    emit('items:changed', { reason: 'created', ids: [id], summaries: [item] })
    let step = 1
    const tick = (): void => {
      const status = PIPELINE[step]
      if (!status) return
      const current = state.items.get(id)
      if (!current || state.trashed.has(id)) return
      const updated: ItemSummary = { ...current, processingStatus: status }
      if (status === 'READY') {
        updated.understanding = `Kept from a drop. This looks like ${type === 'url' ? 'a page worth reading later' : 'a reference file'}.`
        if (type === 'url' && !updated.thumbnailUrl) {
          updated.thumbnailUrl = svgThumb(800, 500, '#2a2622', '#4a443d', 'bars')
          updated.width = 1280
          updated.height = 800
        }
      }
      state.items.set(id, updated)
      emit('jobs:progress', {
        itemId: id,
        batchId: null,
        processingStatus: status,
        stage: step <= 2 ? 'extract' : step === 3 ? 'understand' : 'relate',
        jobStatus: status === 'READY' ? 'done' : 'running',
        attempts: 1
      })
      emit('items:changed', { reason: 'updated', ids: [id], summaries: [updated] })
      step += 1
      if (PIPELINE[step]) setTimeout(tick, 900)
    }
    setTimeout(tick, 700)
    return item
  }

  const search = (query: string, limit = 12): SearchHit[] => {
    const q = tokenize(query)
    if (q.length === 0) return []
    const nowIso = new Date().toISOString()
    return live()
      .map((i) => {
        const hay = tokenize(`${i.title} ${i.domain ?? ''} ${i.understanding ?? ''} ${i.excerpt ?? ''}`)
        const matched = q.filter((t) => hay.some((h) => h.startsWith(t)))
        return { item: i, score: matched.length / q.length }
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ item, score }) => ({
        id: item.id,
        title: item.title,
        type: item.type,
        subtype: item.subtype,
        kind: item.kind,
        domain: item.domain,
        capturedAt: item.capturedAt,
        capturedAgo: relativeTime(item.capturedAt, nowIso),
        understanding: item.understanding ? item.understanding.slice(0, 140) : null,
        thumbnailUrl: item.thumbnailUrl,
        evidence: { bm25Norm: score, matchedFields: ['title'] },
        score
      }))
  }

  /** Emits `running` before the invoke resolves, then steps, then a result. */
  const cancelled = new Set<string>()
  const startRun = (question: string, itemIds: string[] | undefined, template?: string): string => {
    const runId = uid('run')
    const hits = search(question, 4)
    const sources = (itemIds && itemIds.length > 0 ? itemIds : hits.map((h) => h.id)).slice(0, 4)
    const steps: AgentStep[] = [
      {
        n: 1,
        tool: 'search_library',
        kind: 'search',
        label: `Looked at ${Math.max(hits.length, 3)} recent items`,
        itemIds: sources,
        status: 'ok',
        durationMs: 120
      },
      {
        n: 2,
        tool: 'inspect_item',
        kind: 'read',
        label: `Read ${Math.min(sources.length, 2)} of them`,
        itemIds: sources.slice(0, 2),
        status: 'ok',
        durationMs: 640
      },
      {
        n: 3,
        tool: 'compare',
        kind: 'compare',
        label: 'Compared what they say',
        itemIds: sources,
        status: 'ok',
        durationMs: 880
      }
    ]
    const base: AgentRunEvent = { runId, task: 'command', status: 'running' }
    const run: AgentRunDetail = {
      id: runId,
      itemId: null,
      batchId: null,
      task: 'command',
      status: 'running',
      model: state.settings.model,
      startedAt: new Date().toISOString(),
      completedAt: null,
      stepCount: 0,
      error: null,
      steps: [],
      undoable: false,
      usage: null,
      result: null
    }
    state.runs.set(runId, run)
    emit('agent:run', base)
    steps.forEach((step, i) => {
      setTimeout(
        () => {
          if (cancelled.has(runId)) return
          run.steps.push(step)
          run.stepCount = run.steps.length
          emit('agent:run', { ...base, step })
        },
        700 * (i + 1)
      )
    })
    setTimeout(
      () => {
        if (cancelled.has(runId)) return
        const answer =
          sources.length > 0
            ? 'Most of what you kept here is about serving cost: continuous batching, PagedAttention and hosted provider pricing. The recurring theme is choosing between self-hosting vLLM and a hosted MiniMax endpoint.'
            : "Couldn't find anything about that."
        const mapped = sources.map((id, i) => ({
          itemId: id,
          role: (i === 0 ? 'primary' : 'supporting') as 'primary' | 'supporting',
          why: i === 0 ? 'Directly answers the question.' : 'Adds supporting numbers.'
        }))
        const cues = { topics: ['inference', 'serving cost'], types: [] as ItemSummary['type'][] }
        let result: AgentRunDetail['result']
        if (template === 'brief' && sources.length > 0) {
          const note = capture(`Brief - ${question.slice(0, 40)}`, 'note', {
            excerpt: answer,
            kind: 'note',
            processingStatus: 'READY',
            understanding: 'A generated brief citing the selected items.'
          })
          result = { task: 'command', kind: 'note', noteId: note.id, sources: mapped, cues, confidence: 0.8 }
        } else {
          result = {
            task: 'command',
            kind: 'answer',
            answer,
            sources: mapped,
            cues,
            confidence: sources.length > 0 ? 0.78 : 0.2,
            proposals: []
          }
          // Organising questions stage a change for approval, like the real agent does.
          const target = [...state.collections.values()][0]
          const first = sources[0]
          if (/organi[sz]e|tidy|clean|sort/i.test(question) && target && first) {
            result.proposals = [
              {
                kind: 'add_to_collection',
                collectionId: target.id,
                itemId: first,
                reason: 'Same topic.',
                confidence: 0.82,
                label: `add “${state.items.get(first)?.title ?? first}” to “${target.name}”`
              }
            ]
          }
        }
        run.status = 'succeeded'
        run.completedAt = new Date().toISOString()
        run.result = result
        // Item actions apply a change; the toast can offer Undo for them.
        run.undoable = template === undefined && itemIds !== undefined && itemIds.length === 1
        emit('agent:run', { ...base, status: 'succeeded', result, undoable: run.undoable })
      },
      700 * (steps.length + 1)
    )
    return runId
  }

  async function invoke<C extends IpcChannel>(
    channel: C,
    payload: IpcRequestMap[C]
  ): Promise<IpcEnvelope<IpcResponseMap[C]>> {
    // Small latency so loading states are visible but never in the way.
    await new Promise((r) => setTimeout(r, 30))
    const respond = (data: IpcResponseMap[C]): IpcEnvelope<IpcResponseMap[C]> => ok(data)
    const p = payload as never
    switch (channel) {
      case 'items:list':
        return respond(listItems(p as IpcRequestMap['items:list']) as IpcResponseMap[C])
      case 'items:get': {
        const d = detail((p as IpcRequestMap['items:get']).id)
        return d ? respond(d as IpcResponseMap[C]) : fail('NOT_FOUND', 'That item is gone.')
      }
      case 'items:update': {
        const { id, patch } = p as IpcRequestMap['items:update']
        const item = state.items.get(id)
        if (!item) return fail('NOT_FOUND', 'That item is gone.')
        const updated = {
          ...item,
          ...(patch.title ? { title: patch.title } : {}),
          ...(patch.understanding ? { understanding: patch.understanding } : {})
        }
        state.items.set(id, updated)
        emit('items:changed', { reason: 'updated', ids: [id], summaries: [updated] })
        return respond(detail(id) as IpcResponseMap[C])
      }
      case 'items:trash': {
        const { ids } = p as IpcRequestMap['items:trash']
        for (const id of ids) state.trashed.add(id)
        emit('items:changed', { reason: 'trashed', ids })
        emit('collections:changed', {})
        return respond(undefined as IpcResponseMap[C])
      }
      case 'items:restore': {
        const { ids } = p as IpcRequestMap['items:restore']
        for (const id of ids) state.trashed.delete(id)
        emit('items:changed', {
          reason: 'restored',
          ids,
          summaries: ids.map((id) => state.items.get(id)).filter((i): i is ItemSummary => Boolean(i))
        })
        emit('collections:changed', {})
        return respond(undefined as IpcResponseMap[C])
      }
      case 'items:deleteForever': {
        const { ids } = p as IpcRequestMap['items:deleteForever']
        ids.forEach((id) => {
          state.items.delete(id)
          state.trashed.delete(id)
        })
        emit('items:changed', { reason: 'deleted', ids })
        return respond(undefined as IpcResponseMap[C])
      }
      case 'items:reprocess': {
        const { id } = p as IpcRequestMap['items:reprocess']
        const item = state.items.get(id)
        if (!item) return fail('NOT_FOUND', 'That item is gone.')
        const updated = { ...item, processingStatus: 'UNDERSTANDING' as ProcessingStatus, processingError: null }
        state.items.set(id, updated)
        emit('items:changed', { reason: 'updated', ids: [id], summaries: [updated] })
        setTimeout(() => {
          const done = {
            ...updated,
            processingStatus: 'READY' as ProcessingStatus,
            understanding: updated.understanding ?? 'Understood on the second try.'
          }
          state.items.set(id, done)
          emit('items:changed', { reason: 'updated', ids: [id], summaries: [done] })
        }, 1800)
        return respond(undefined as IpcResponseMap[C])
      }
      case 'items:reprocessAll':
        return respond({ count: live().length } as IpcResponseMap[C])
      case 'items:cancel': {
        const { ids } = p as IpcRequestMap['items:cancel']
        for (const id of ids) {
          const item = state.items.get(id)
          if (!item) continue
          const stopped = { ...item, processingStatus: 'PARTIAL' as ProcessingStatus }
          state.items.set(id, stopped)
          emit('items:changed', { reason: 'updated', ids: [id], summaries: [stopped] })
        }
        return respond(undefined as IpcResponseMap[C])
      }
      case 'items:openOriginal':
      case 'items:revealInFinder':
      case 'items:quickLook':
      case 'items:openUrl':
      case 'system:openExternal':
      case 'system:revealLibrary':
      case 'agent:undo':
      case 'relationships:remove':
        return respond(undefined as IpcResponseMap[C])
      case 'agent:undoRun': {
        const run = state.runs.get((p as IpcRequestMap['agent:undoRun']).runId)
        if (!run) return fail('NOT_FOUND', 'No such run.')
        const undone = run.undoable ? 1 : 0
        run.undoable = false
        return respond({ undone } as IpcResponseMap[C])
      }
      case 'agent:applyProposals': {
        const run = state.runs.get((p as IpcRequestMap['agent:applyProposals']).runId)
        if (!run) return fail('NOT_FOUND', 'No such run.')
        const staged = run.result?.task === 'command' ? (run.result.proposals ?? []) : []
        for (const prop of staged) {
          if (prop.kind !== 'add_to_collection') continue
          if (!state.membership.has(prop.collectionId)) state.membership.set(prop.collectionId, new Set())
          state.membership.get(prop.collectionId)?.add(prop.itemId)
          const item = state.items.get(prop.itemId)
          if (item && !item.collectionIds.includes(prop.collectionId)) {
            const updated = { ...item, collectionIds: [...item.collectionIds, prop.collectionId] }
            state.items.set(item.id, updated)
            emit('items:changed', { reason: 'updated', ids: [item.id], summaries: [updated] })
          }
        }
        if (run.result?.task === 'command') {
          run.result = { ...run.result, proposals: [], appliedCount: (run.result.appliedCount ?? 0) + staged.length }
        }
        run.undoable = run.undoable || staged.length > 0
        if (staged.length > 0) emit('collections:changed', {})
        return respond({ applied: staged.length, remaining: [] } as unknown as IpcResponseMap[C])
      }
      case 'items:readContent': {
        const item = state.items.get((p as IpcRequestMap['items:readContent']).id)
        return respond({ markdown: item?.excerpt ?? '' } as IpcResponseMap[C])
      }
      case 'capture:files': {
        const { paths } = p as IpcRequestMap['capture:files']
        const items = paths.map((path) => capture(path.split('/').pop() ?? path, 'file', { size: 12_000 }))
        return respond({
          items: items.map((i) => ({ id: i.id, status: 'created' as const, title: i.title })),
          batchId: uid('batch')
        } as IpcResponseMap[C])
      }
      case 'capture:url': {
        const { url } = p as IpcRequestMap['capture:url']
        const item = capture(url.replace(/^https?:\/\//, ''), 'url', {
          url,
          domain: url.replace(/^https?:\/\//, '').split('/')[0] ?? null
        })
        return respond({
          items: [{ id: item.id, status: 'created' as const, title: item.title }],
          batchId: uid('batch')
        } as IpcResponseMap[C])
      }
      case 'capture:text': {
        const { text, title } = p as IpcRequestMap['capture:text']
        const item = capture(title ?? text.slice(0, 48), 'text', { excerpt: text.slice(0, 280), size: text.length })
        return respond({
          items: [{ id: item.id, status: 'created' as const, title: item.title }],
          batchId: uid('batch')
        } as IpcResponseMap[C])
      }
      case 'capture:blob': {
        const { name } = p as IpcRequestMap['capture:blob']
        const item = capture(name, 'image', {
          width: 1200,
          height: 800,
          thumbnailUrl: svgThumb(800, 533, '#26232a', '#57515f', 'grid')
        })
        return respond({
          items: [{ id: item.id, status: 'created' as const, title: item.title }],
          batchId: uid('batch')
        } as IpcResponseMap[C])
      }
      case 'capture:drop': {
        const req = p as IpcRequestMap['capture:drop']
        const created: ItemSummary[] = []
        for (const path of req.files) created.push(capture(path.split('/').pop() ?? path, 'file', { size: 24_000 }))
        const firstUri = req.uriList?.split(/\r?\n/).find((l) => l && !l.startsWith('#'))
        if (firstUri)
          created.push(
            capture(firstUri.replace(/^https?:\/\//, ''), 'url', {
              url: firstUri,
              domain: firstUri.replace(/^https?:\/\//, '').split('/')[0] ?? null
            })
          )
        else if (req.text)
          created.push(
            capture(req.text.slice(0, 48), 'text', { excerpt: req.text.slice(0, 280), size: req.text.length })
          )
        if (req.collectionId) {
          const members = state.membership.get(req.collectionId) ?? new Set<string>()
          state.membership.set(req.collectionId, members)
          for (const i of created) members.add(i.id)
          emit('collections:changed', {})
        }
        const result: CaptureResult = {
          items: created.map((i) => ({ id: i.id, status: 'created', title: i.title })),
          batchId: uid('batch')
        }
        if (req.source === 'shelf') emit('shelf:dropped', { result })
        return respond(result as IpcResponseMap[C])
      }
      case 'collections:list':
        return respond(collectionSummaries() as IpcResponseMap[C])
      case 'collections:create': {
        const { name, description } = p as IpcRequestMap['collections:create']
        const now = new Date().toISOString()
        const c: CollectionSummary = {
          id: uid('col'),
          name,
          nameKey: name.toLowerCase(),
          description: description ?? null,
          createdBy: 'user',
          color: null,
          pinned: false,
          createdAt: now,
          updatedAt: now,
          count: 0,
          coverThumbnailUrls: []
        }
        state.collections.set(c.id, c)
        emit('collections:changed', {})
        return respond(c as unknown as IpcResponseMap[C])
      }
      case 'collections:rename': {
        const { id, name, description } = p as IpcRequestMap['collections:rename']
        const c = state.collections.get(id)
        if (!c) return fail('NOT_FOUND', 'That collection is gone.')
        state.collections.set(id, { ...c, name, description: description ?? c.description })
        emit('collections:changed', {})
        return respond(undefined as IpcResponseMap[C])
      }
      case 'collections:delete': {
        state.collections.delete((p as IpcRequestMap['collections:delete']).id)
        emit('collections:changed', {})
        return respond(undefined as IpcResponseMap[C])
      }
      case 'collections:addItems': {
        const { id, itemIds } = p as IpcRequestMap['collections:addItems']
        if (!state.collections.has(id)) return fail('NOT_FOUND', 'That collection is gone.')
        if (!state.membership.has(id)) state.membership.set(id, new Set())
        const set = state.membership.get(id)
        const summaries: ItemSummary[] = []
        for (const itemId of itemIds) {
          set?.add(itemId)
          const item = state.items.get(itemId)
          if (item && !item.collectionIds.includes(id)) {
            const updated = { ...item, collectionIds: [...item.collectionIds, id] }
            state.items.set(itemId, updated)
            summaries.push(updated)
          }
        }
        emit('collections:changed', {})
        if (summaries.length > 0)
          emit('items:changed', { reason: 'updated', ids: summaries.map((s) => s.id), summaries })
        return respond(undefined as IpcResponseMap[C])
      }
      case 'collections:removeItem': {
        const { id, itemId } = p as IpcRequestMap['collections:removeItem']
        state.membership.get(id)?.delete(itemId)
        const item = state.items.get(itemId)
        if (item) {
          const updated = { ...item, collectionIds: item.collectionIds.filter((c) => c !== id) }
          state.items.set(itemId, updated)
          emit('items:changed', { reason: 'updated', ids: [itemId], summaries: [updated] })
        }
        emit('collections:changed', {})
        return respond(undefined as IpcResponseMap[C])
      }
      case 'relationships:create': {
        const { sourceId, targetId, type, description } = p as IpcRequestMap['relationships:create']
        return respond({
          id: uid('rel'),
          sourceItemId: sourceId,
          targetItemId: targetId,
          type,
          description: description ?? null,
          confidence: null,
          evidence: null,
          createdBy: 'user',
          agentRunId: null,
          createdAt: new Date().toISOString()
        } as IpcResponseMap[C])
      }
      case 'search:quick': {
        const { query, limit } = p as IpcRequestMap['search:quick']
        return respond(search(query, limit) as IpcResponseMap[C])
      }
      case 'agent:command': {
        const { question, itemIds, template } = p as IpcRequestMap['agent:command']
        return respond({ runId: startRun(question, itemIds, template) } as IpcResponseMap[C])
      }
      case 'agent:runs': {
        const { limit = 200 } = p as IpcRequestMap['agent:runs']
        const list = [...state.runs.values()]
          .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
          .slice(0, limit)
          .map(({ usage: _u, result: _r, ...summary }) => summary)
        return respond(list as IpcResponseMap[C])
      }
      case 'agent:cancel': {
        const { runId } = p as IpcRequestMap['agent:cancel']
        const run = state.runs.get(runId)
        if (run && run.status === 'running') {
          cancelled.add(runId)
          run.status = 'cancelled'
          run.completedAt = new Date().toISOString()
          emit('agent:run', {
            runId,
            task: 'command',
            status: 'cancelled',
            error: { code: 'CANCELLED', message: 'Stopped.' }
          })
        }
        return respond(undefined as IpcResponseMap[C])
      }
      case 'agent:run': {
        const run = state.runs.get((p as IpcRequestMap['agent:run']).id)
        return run ? respond(run as IpcResponseMap[C]) : fail('NOT_FOUND', 'No such run.')
      }
      case 'settings:get':
        return respond(state.settings as IpcResponseMap[C])
      case 'settings:update': {
        const patch = p as IpcRequestMap['settings:update']
        const next: Settings = { ...state.settings }
        if (patch.apiKey) {
          next.hasApiKey = true
          next.apiKeyMasked = `${patch.apiKey.slice(0, 3)}…${patch.apiKey.slice(-4)}`
          next.aiMode = 'gmi'
        }
        if (patch.clearApiKey) {
          next.hasApiKey = false
          next.apiKeyMasked = null
        }
        if (patch.aiMode) next.aiMode = patch.aiMode
        if (patch.model) next.model = patch.model
        if (patch.baseUrl) next.baseUrl = patch.baseUrl
        if (patch.importMode) next.importMode = patch.importMode
        if (patch.theme) next.theme = patch.theme
        state.settings = next
        emit('settings:changed', { settings: next })
        if (patch.theme) {
          const resolved =
            patch.theme === 'system'
              ? typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches
                ? 'light'
                : 'dark'
              : patch.theme
          emit('theme:changed', { theme: resolved })
        }
        return respond(next as IpcResponseMap[C])
      }
      case 'settings:testConnection':
        await new Promise((r) => setTimeout(r, 600))
        return respond(
          (state.settings.hasApiKey
            ? { ok: true, model: state.settings.model, latencyMs: 412 }
            : { ok: false, model: state.settings.model, latencyMs: 0, error: 'No API key yet.' }) as IpcResponseMap[C]
        )
      case 'system:stats': {
        const items = live()
        return respond({
          items: items.length,
          connections: FIXTURE_RELATIONSHIPS.length,
          collections: state.collections.size,
          processing: items.filter((i) => !isTerminal(i.processingStatus)).length,
          aiStatus: state.settings.hasApiKey
            ? 'connected'
            : state.settings.aiMode === 'mock'
              ? 'connected'
              : 'unconfigured'
        } as IpcResponseMap[C])
      }
      case 'system:contextMenu':
        return respond({} as IpcResponseMap[C])
      case 'system:chooseFiles':
        return respond({ paths: [] as string[] } as unknown as IpcResponseMap[C])
      case 'jobs:status':
        return respond(state.jobs as IpcResponseMap[C])
      default:
        return fail('NOT_IMPLEMENTED', `Mock has no handler for ${String(channel)}`)
    }
  }

  return {
    invoke,
    on<E extends IpcEventName>(event: E, listener: (payload: IpcEventMap[E]) => void): () => void {
      if (!listeners.has(event)) listeners.set(event, new Set())
      const set = listeners.get(event) as Set<Listener<IpcEventName>>
      set.add(listener as Listener<IpcEventName>)
      return () => {
        set.delete(listener as Listener<IpcEventName>)
      }
    },
    getPathForFile: () => '',
    platform: typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? 'darwin' : 'other'
  }
}
