/** Ask My Stuff, multi-item templates and item actions as bounded tool-loop runs streamed through `agent.run` events and persisted in `agent_runs` (labels and ids only, never prompts or content beyond a bounded excerpt). */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { LIMITS } from '../../shared/constants'
import type { AgentCommandRequest, AgentRunEvent, IpcError, TestConnectionResult } from '../../shared/ipc'
import { truncate } from '../../shared/text'
import type {
  AgentCues,
  AgentProposal,
  AgentResult,
  AgentRunDetail,
  AgentSource,
  AgentStep,
  AgentUsage,
  CommandTemplate,
  Item
} from '../../shared/types'
import { buildCommandMessages, type CommandFinish, type CommandInput, type CommandSeed } from '../ai'
import { AUDIT_ACTIONS, type AuditService } from '../core/audit'
import type { CollectionService } from '../core/collection-service'
import { isKaError, KaError } from '../core/errors'
import { type IdGenerator, uuid } from '../core/ids'
import type { ItemService } from '../core/item-service'
import type { RelationshipService } from '../core/relationship-service'
import { sha256Bytes } from '../lib/fs'
import type { Queue } from '../pipeline/queue'
import type { AgentActor, AgentService, AIProvider, Clock, EventBus, Logger, Paths } from '../ports'
import type { RetrievalService } from '../retrieval'
import type { Db } from '../storage/db'
import type { ObjectStore } from '../storage/object-store'
import type { Repositories } from '../storage/repositories'
import { COMMAND_MAX_STEPS, runToolLoop } from './orchestrator'
import { testConnection as probeConnection } from './test-connection'
import { AGENT_TOOLS, FINISH_TOOL, type ProposedAction } from './tools/definitions'
import { createRunMemory, dispatchTool, type RunMemory, type ToolEnv } from './tools/handlers'

export {
  COMMAND_MAX_STEPS,
  normalizeFinishArguments,
  runToolLoop,
  type ToolLoopOptions,
  type ToolLoopResult
} from './orchestrator'
export { testConnection } from './test-connection'
export { AGENT_TOOLS, FINISH_TOOL, type ProposedAction, TOOL_NAMES } from './tools/definitions'
export { createRunMemory, dispatchTool, MAX_TOOL_RESULT_CHARS, type RunMemory, type ToolEnv } from './tools/handlers'

export interface AgentServiceDeps {
  db?: Db
  repos: Repositories
  retrieval: RetrievalService
  /** The current provider (the bootstrap swaps it on settings change; pass a getter). */
  ai: AIProvider | (() => AIProvider)
  items: ItemService
  collections: CollectionService
  relationships: RelationshipService
  audit: AuditService
  events: EventBus
  clock: Clock
  logger: Logger
  paths: Pick<Paths, 'contentDir'>
  objectStore?: Pick<ObjectStore, 'resolve'>
  queue?: Pick<Queue, 'enqueueInitial'>
  ids?: IdGenerator
  /** Step cap (default `COMMAND_MAX_STEPS`). */
  maxSteps?: number
  /** Confidence at or above which item-action runs apply their own proposals. */
}

/** The service plus the extras the bootstrap / tests use. */
export interface CommandAgentService extends AgentService {
  /** `settings:testConnection`. */
  testConnection(): Promise<TestConnectionResult>
  /** Runs still in flight. */
  activeRuns(): string[]
}

interface RunState {
  detail: AgentRunDetail
  controller: AbortController
  memory: RunMemory
  mode: CommandInput['mode']
  question: string
  seedIds: string[]
}

const TEMPLATE_OF: Record<CommandTemplate, true> = {
  compare: true,
  common: true,
  summarize: true,
  brief: true,
  extract: true,
  custom: true
}

export function createAgentService(deps: AgentServiceDeps): CommandAgentService {
  const { repos, retrieval, items, collections, relationships, audit, events, clock } = deps
  const logger = deps.logger.child({ scope: 'agent' })
  const ids = deps.ids ?? uuid
  const maxSteps = deps.maxSteps ?? COMMAND_MAX_STEPS
  const runs = new Map<string, RunState>()
  const provider = (): AIProvider => (typeof deps.ai === 'function' ? deps.ai() : deps.ai)

  const emit = (state: RunState, patch: Partial<AgentRunEvent>): void => {
    const d = state.detail
    events.emit('agent.run', {
      runId: d.id,
      task: d.task,
      status: d.status,
      ...(d.itemId ? { itemId: d.itemId } : {}),
      ...(d.batchId ? { batchId: d.batchId } : {}),
      ...patch
    })
  }

  async function readContent(item: Item): Promise<string | null> {
    try {
      if (item.type === 'note' && item.managedPath)
        return await readFile(join(deps.paths.contentDir, item.managedPath), 'utf8')
      if ((item.type === 'text' || item.type === 'markdown') && item.managedPath && deps.objectStore)
        return await readFile(deps.objectStore.resolve(item.managedPath), 'utf8')
      if ((item.type === 'text' || item.type === 'markdown') && item.originalPath)
        return await readFile(item.originalPath, 'utf8')
    } catch (error) {
      logger.debug('agent.read_content_failed', { id: item.id, error })
    }
    return item.extractedText
  }

  const toolEnv: ToolEnv = { retrieval, repos, clock, readContent }

  const seedOf = (item: Item): CommandSeed => ({
    id: item.id,
    title: item.title,
    type: item.subtype ? `${item.type}/${item.subtype}` : item.type,
    kind: item.kind,
    understanding: item.understanding ? truncate(item.understanding, 200) : null,
    capturedAgo: relativeAgo(item.capturedAt)
  })
  const relativeAgo = (iso: string): string => {
    const days = Math.max(0, Math.round((clock.now().getTime() - Date.parse(iso)) / 86_400_000))
    return days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`
  }

  function start(input: CommandInput, question: string, seedIds: string[], itemId: string | null): RunState {
    const controller = new AbortController()
    const detail: AgentRunDetail = {
      id: ids(),
      itemId,
      batchId: null,
      task: 'command',
      status: 'running',
      model: provider().model,
      startedAt: clock.nowIso(),
      completedAt: null,
      stepCount: 0,
      error: null,
      steps: [],
      undoable: false,
      usage: null,
      result: null
    }
    repos.agentRuns.insert(detail)
    const state: RunState = { detail, controller, memory: createRunMemory(), mode: input.mode, question, seedIds }
    runs.set(detail.id, state)
    emit(state, {})
    void execute(state, input)
    return state
  }

  async function execute(state: RunState, input: CommandInput): Promise<void> {
    const { detail } = state
    const onStep = (step: AgentStep): void => {
      detail.steps.push(step)
      detail.stepCount = detail.steps.length
      repos.agentRuns.update(detail.id, { steps: detail.steps })
      emit(state, { step })
    }
    try {
      const loop = await runToolLoop({
        provider: provider(),
        messages: buildCommandMessages(input),
        tools: AGENT_TOOLS,
        finish: FINISH_TOOL,
        dispatch: (name, raw) => dispatchTool(name, raw, toolEnv, state.memory),
        onStep,
        signal: state.controller.signal,
        maxSteps,
        logger,
        task: 'command'
      })
      const result = await finalize(state, loop.finish, loop.usage)
      detail.status = 'succeeded'
      detail.completedAt = clock.nowIso()
      detail.result = result
      detail.usage = loop.usage
      detail.undoable = hasUndoableChanges(detail.id)
      repos.agentRuns.update(detail.id, {
        status: 'succeeded',
        completedAt: detail.completedAt,
        result,
        usage: loop.usage,
        steps: detail.steps
      })
      emit(state, { result, undoable: detail.undoable })
      logger.info('agent.run.succeeded', {
        runId: detail.id,
        steps: detail.steps.length,
        sources: result.task === 'command' ? result.sources.length : 0,
        ...loop.usage
      })
    } catch (error) {
      const cancelled = (isKaError(error) && error.code === 'CANCELLED') || state.controller.signal.aborted
      const ipcError: IpcError = cancelled
        ? { code: 'CANCELLED', message: 'Stopped.' }
        : isKaError(error)
          ? { code: error.code, message: error.message }
          : { code: 'INTERNAL', message: 'Something went wrong while answering.' }
      detail.status = cancelled ? 'cancelled' : 'failed'
      detail.completedAt = clock.nowIso()
      detail.error = ipcError.message
      repos.agentRuns.update(detail.id, {
        status: detail.status,
        completedAt: detail.completedAt,
        error: ipcError.message,
        steps: detail.steps
      })
      emit(state, { error: ipcError })
      if (!cancelled) logger.warn('agent.run.failed', { runId: detail.id, error })
    } finally {
      runs.delete(detail.id)
    }
  }

  function cuesFor(state: RunState, finish: CommandFinish): AgentCues {
    const parsed = retrieval.parse(state.question)
    const topics = finish.cues.topics.length > 0 ? finish.cues.topics : parsed.tokens.slice(0, 4)
    const types = finish.cues.types.length > 0 ? finish.cues.types : parsed.cues.types.slice(0, 3)
    const cues: AgentCues = { topics, types }
    if (finish.cues.timeframe) cues.timeframe = finish.cues.timeframe
    else if (parsed.cues.timeframe) cues.timeframe = parsed.cues.timeframe
    return cues
  }

  function validSources(state: RunState, finish: CommandFinish): AgentSource[] {
    const allowed = new Set([...state.memory.seen, ...state.memory.inspected, ...state.seedIds])
    const out: AgentSource[] = []
    for (const s of finish.sources) {
      if (out.some((x) => x.itemId === s.itemId)) continue
      const item = repos.items.get(s.itemId)
      if (!item || item.deletedAt) continue
      if (!allowed.has(s.itemId)) {
        logger.debug('agent.source_dropped: not seen in this run', { runId: state.detail.id, itemId: s.itemId })
        continue
      }
      out.push({ itemId: s.itemId, role: s.role, why: truncate(s.why, 200) })
    }
    return out
  }

  /** True while the run has audited changes that were not undone (drives Undo in the UI). */
  const hasUndoableChanges = (runId: string): boolean => repos.audit.forRun(runId).some((e) => !e.undoneAt)

  /** Staged proposals live on the persisted run row (`result.proposals`), so approval survives restarts. */
  const stagedProposals = (runId: string): AgentProposal[] => {
    const result = repos.agentRuns.get(runId)?.result
    return result?.task === 'command' ? (result.proposals ?? []) : []
  }

  const persistProposals = (runId: string, remaining: AgentProposal[], applied: number): void => {
    const run = repos.agentRuns.get(runId)
    if (run?.result?.task !== 'command') return
    const result: AgentResult = {
      ...run.result,
      proposals: remaining,
      appliedCount: (run.result.appliedCount ?? 0) + applied
    }
    repos.agentRuns.update(runId, { result })
  }

  const toProposal = (p: ProposedAction): AgentProposal => ({ ...p, label: describeProposal(p) })

  function describeProposal(p: ProposedAction): string {
    const title = (id: string): string => `“${truncate(repos.items.get(id)?.title ?? id, 40)}”`
    switch (p.kind) {
      case 'add_to_collection':
        return `add ${title(p.itemId)} to “${repos.collections.get(p.collectionId)?.name ?? p.collectionId}”`
      case 'create_collection':
        return `create “${p.name}” with ${p.itemIds.length} items`
      case 'relate':
        return `connect ${title(p.sourceId)} and ${title(p.targetId)} (${p.type.replace(/_/g, ' ')})`
      case 'tag':
        return `tag ${title(p.itemId)} with ${p.topics.join(', ')}`
      case 'rename':
        return `rename ${title(p.itemId)} to “${p.title}”`
      case 'trash':
        return `move ${title(p.itemId)} to the Trash`
    }
  }

  function applyProposal(runId: string, p: AgentProposal): boolean {
    try {
      switch (p.kind) {
        case 'add_to_collection':
          return (
            collections.addItems(p.collectionId, [{ itemId: p.itemId, confidence: p.confidence, reason: p.reason }], {
              actor: 'agent',
              agentRunId: runId
            }).added.length > 0
          )
        case 'create_collection': {
          const created = collections.create({
            name: p.name,
            description: p.description,
            createdBy: 'agent',
            agentRunId: runId
          })
          collections.addItems(
            created.id,
            p.itemIds.map((itemId) => ({ itemId, confidence: p.confidence, reason: p.reason })),
            { actor: 'agent', agentRunId: runId }
          )
          return true
        }
        case 'relate':
          relationships.create({
            sourceId: p.sourceId,
            targetId: p.targetId,
            type: p.type,
            description: p.description,
            confidence: p.confidence,
            createdBy: 'agent',
            agentRunId: runId
          })
          return true
        case 'tag': {
          const item = repos.items.get(p.itemId)
          if (!item || item.userOverrides.topics) return false
          const topics = [...item.topics]
          for (const t of p.topics)
            if (!topics.some((x) => x.toLowerCase() === t.toLowerCase()) && topics.length < 6) topics.push(t)
          repos.items.update(item.id, { topics, modifiedAt: clock.nowIso() })
          audit.record({
            actor: 'agent',
            action: AUDIT_ACTIONS.updateUnderstanding,
            entity: 'item',
            entityId: item.id,
            before: { topics: item.topics },
            after: { topics },
            agentRunId: runId
          })
          return true
        }
        case 'rename': {
          const item = repos.items.get(p.itemId)
          if (!item || item.userOverrides.title) return false
          repos.items.update(item.id, { title: p.title.slice(0, 160), modifiedAt: clock.nowIso() })
          audit.record({
            actor: 'agent',
            action: AUDIT_ACTIONS.updateUnderstanding,
            entity: 'item',
            entityId: item.id,
            before: { title: item.title },
            after: { title: p.title.slice(0, 160) },
            agentRunId: runId
          })
          return true
        }
        case 'trash':
          // Trashing is the person's call; it is only ever staged.
          return false
      }
    } catch (error) {
      logger.info('agent.proposal_skipped', { runId, kind: p.kind, error })
      return false
    }
  }

  async function createNote(state: RunState, finish: CommandFinish, sources: AgentSource[]): Promise<string> {
    const markdown = (finish.noteMarkdown ?? '').trim()
    const heading = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim()
    const title = finish.noteTitle?.trim() || heading || `Note: ${truncate(state.question, 60)}`
    const id = ids()
    const fileName = `${id}.md`
    await mkdir(deps.paths.contentDir, { recursive: true })
    await writeFile(join(deps.paths.contentDir, fileName), `${markdown}\n`, 'utf8')
    const firstParagraph = markdown
      .split(/\n{2,}/)
      .map((p) => p.replace(/^#+\s*/, '').trim())
      .find((p) => p.length > 0 && !p.startsWith('#'))
    const create = (): Item => {
      const note = items.create({
        id,
        type: 'note',
        title,
        managedPath: fileName,
        mimeType: 'text/markdown',
        size: Buffer.byteLength(markdown, 'utf8'),
        contentHash: sha256Bytes(markdown),
        kind: 'note',
        understanding: firstParagraph ? truncate(firstParagraph, 400) : null,
        extractedText: markdown.slice(0, LIMITS.maxExtractedChars),
        excerpt: truncate(markdown.replace(/\s+/g, ' '), LIMITS.excerptChars),
        metadata: { sources },
        processingStatus: 'CAPTURED'
      })
      audit.record({
        actor: 'agent',
        action: AUDIT_ACTIONS.createNote,
        entity: 'item',
        entityId: id,
        after: { title, sources },
        agentRunId: state.detail.id
      })
      for (const source of sources) {
        try {
          relationships.create({
            sourceId: id,
            targetId: source.itemId,
            type: 'created_from',
            description: source.why,
            confidence: 1,
            createdBy: 'agent',
            agentRunId: state.detail.id
          })
        } catch (error) {
          logger.debug('agent.note_relationship_skipped', { error })
        }
      }
      deps.queue?.enqueueInitial(note)
      return note
    }
    if (deps.db) deps.db.transaction(create)
    else create()
    return id
  }

  async function finalize(state: RunState, finish: CommandFinish, _usage: AgentUsage): Promise<AgentResult> {
    const sources = validSources(state, finish)
    const cues = cuesFor(state, finish)
    const staged = state.memory.proposals.map(toProposal)
    let answer = finish.answer?.trim() ?? ''
    let noteId: string | undefined
    if (finish.kind === 'note' && finish.noteMarkdown && finish.noteMarkdown.trim().length > 0) {
      noteId = await createNote(state, finish, sources)
      const note = repos.items.get(noteId)
      if (!answer) answer = `Created “${note?.title ?? 'a note'}”.`
    }

    // Proposals stay staged for approval; the UI renders the list with Apply / Undo controls.
    const applied = 0
    const remaining: AgentProposal[] = [...staged]

    const result: AgentResult = {
      task: 'command',
      kind: noteId ? 'note' : 'answer',
      sources,
      cues,
      confidence: finish.confidence,
      proposals: remaining
    }
    if (answer.length > 0) result.answer = answer
    if (noteId) result.noteId = noteId
    if (applied > 0) result.appliedCount = applied
    return result
  }

  const today = (): string => clock.nowIso().slice(0, 10)

  return {
    async command(input: AgentCommandRequest, _actor: AgentActor = 'user') {
      const question = input.question.trim()
      const seedIds = (input.itemIds ?? []).filter((id) => repos.items.get(id))
      const template = input.template && TEMPLATE_OF[input.template] ? input.template : undefined
      let command: CommandInput
      if (seedIds.length > 0) {
        const seeds = repos.items.getMany(seedIds).map(seedOf)
        command = {
          mode: 'template',
          template: template ?? 'custom',
          seeds,
          ...(question.length > 0 ? { instruction: question } : {}),
          today: today()
        }
      } else {
        if (question.length === 0) throw new KaError('VALIDATION', 'Ask something first.')
        command = { mode: 'ask', question, today: today(), history: input.history }
      }
      const state = start(
        command,
        question || (template ?? 'selected items'),
        seedIds,
        seedIds.length === 1 ? (seedIds[0] as string) : null
      )
      return { runId: state.detail.id }
    },
    cancel(runId) {
      runs.get(runId)?.controller.abort(new KaError('CANCELLED', 'Stopped.'))
    },
    getRun(runId) {
      const live = runs.get(runId)
      if (live) return { ...live.detail, steps: [...live.detail.steps] }
      return repos.agentRuns.get(runId)
    },
    undo(auditId) {
      audit.undo(auditId)
    },
    undoRun(runId) {
      let undone = 0
      const entries = repos.audit
        .forRun(runId)
        .filter((e) => !e.undoneAt)
        .reverse()
      for (const entry of entries) {
        try {
          audit.undo(entry.id)
          undone++
        } catch (error) {
          logger.info('agent.undo_skipped', { auditId: entry.id, error })
        }
      }
      return undone
    },
    proposals: (runId) => [...stagedProposals(runId)],
    applyProposals(runId) {
      const staged = stagedProposals(runId)
      let applied = 0
      const remaining: AgentProposal[] = []
      for (const p of staged) {
        if (p.kind === 'trash') {
          try {
            items.trash([p.itemId])
            applied++
          } catch (error) {
            logger.info('agent.proposal_skipped', { runId, kind: p.kind, error })
            remaining.push(p)
          }
          continue
        }
        if (applyProposal(runId, p)) applied++
        else remaining.push(p)
      }
      persistProposals(runId, remaining, applied)
      return { applied, remaining: [...remaining] }
    },
    testConnection: () => probeConnection(provider()),
    activeRuns: () => [...runs.keys()]
  }
}
