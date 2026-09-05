/**
 * IPC contract between renderer and main. This file and `types.ts` are the
 * source of truth: channel names, request/response payloads, push events and the error envelope.
 * Payloads are validated with zod in `main/ipc/schemas.ts`; this file stays dependency-free.
 *
 * Conventions
 * - Every `invoke` resolves to an `IpcEnvelope`: `{ ok: true, data } | { ok: false, error }`.
 *   Handlers throw `KaError`; the router maps it, anything else becomes `INTERNAL`.
 * - `capture:drop`: the renderer sends the RAW `dataTransfer` snapshot (file paths from
 *   `getPathForFile`, `text/uri-list`, `text/plain`, `text/html`) and does ZERO classification.
 *   Intake owns every precedence rule (webloc vs files, image URLs, temp paths, URL-vs-text).
 * - `agent:run` (event): subscribe ONCE at boot into a store keyed by `runId`. The `running` event
 *   is emitted BEFORE the `agent:command` invoke resolves, so the store must accept
 *   events for run ids it has not seen yet; the invoke result only tells the caller which id to
 *   watch. Subsequent events arrive after every tool step and once at the end.
 * - Events are pushed to every app window; stores subscribe once at boot, never per component.
 */

import type {
  AgentProposal,
  AgentResult,
  AgentRunDetail,
  AgentRunStatus,
  AgentStep,
  AgentTask,
  CaptureDropSource,
  CaptureMode,
  CaptureResult,
  Collection,
  CollectionSummary,
  CommandTemplate,
  ContextMenuKind,
  DynamicQuery,
  ItemDetail,
  ItemSummary,
  ItemsSort,
  ItemsView,
  ItemType,
  JobProgress,
  Relationship,
  RelationshipType,
  ResolvedTheme,
  SearchHit,
  Settings,
  SettingsPatch,
  Stage,
  SystemStats
} from './types'

/** Every request channel. Keys are for code, values are the wire names. */
export const IPC_CHANNELS = {
  itemsList: 'items:list',
  itemsGet: 'items:get',
  itemsUpdate: 'items:update',
  itemsTrash: 'items:trash',
  itemsRestore: 'items:restore',
  itemsDeleteForever: 'items:deleteForever',
  itemsReprocess: 'items:reprocess',
  itemsReprocessAll: 'items:reprocessAll',
  itemsOpenOriginal: 'items:openOriginal',
  itemsRevealInFinder: 'items:revealInFinder',
  itemsQuickLook: 'items:quickLook',
  itemsOpenUrl: 'items:openUrl',
  itemsReadContent: 'items:readContent',
  captureFiles: 'capture:files',
  captureUrl: 'capture:url',
  captureText: 'capture:text',
  captureBlob: 'capture:blob',
  captureDrop: 'capture:drop',
  collectionsList: 'collections:list',
  collectionsCreate: 'collections:create',
  collectionsCreateDynamic: 'collections:createDynamic',
  collectionsRename: 'collections:rename',
  collectionsDelete: 'collections:delete',
  collectionsAddItems: 'collections:addItems',
  collectionsRemoveItem: 'collections:removeItem',
  relationshipsCreate: 'relationships:create',
  relationshipsRemove: 'relationships:remove',
  searchQuick: 'search:quick',
  agentCommand: 'agent:command',
  agentCancel: 'agent:cancel',
  agentRun: 'agent:run',
  agentUndo: 'agent:undo',
  agentUndoRun: 'agent:undoRun',
  agentApplyProposals: 'agent:applyProposals',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsTestConnection: 'settings:testConnection',
  systemStats: 'system:stats',
  systemContextMenu: 'system:contextMenu',
  systemOpenExternal: 'system:openExternal',
  systemChooseFiles: 'system:chooseFiles',
  systemRevealLibrary: 'system:revealLibrary',
  jobsStatus: 'jobs:status'
} as const

/** Wire name of a request channel. */
export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]

/** All request channel names (for preload validation and router registration). */
export const IPC_CHANNEL_LIST: readonly IpcChannel[] = Object.values(IPC_CHANNELS)

export function isIpcChannel(value: unknown): value is IpcChannel {
  return typeof value === 'string' && (IPC_CHANNEL_LIST as readonly string[]).includes(value)
}

export const IPC_EVENTS = {
  itemsChanged: 'items:changed',
  jobsProgress: 'jobs:progress',
  collectionsChanged: 'collections:changed',
  agentRun: 'agent:run',
  shelfDropped: 'shelf:dropped',
  settingsChanged: 'settings:changed',
  themeChanged: 'theme:changed'
} as const

/** Wire name of a push event. */
export type IpcEventName = (typeof IPC_EVENTS)[keyof typeof IPC_EVENTS]

/** All push event names (for preload validation). */
export const IPC_EVENT_LIST: readonly IpcEventName[] = Object.values(IPC_EVENTS)

export function isIpcEventName(value: unknown): value is IpcEventName {
  return typeof value === 'string' && (IPC_EVENT_LIST as readonly string[]).includes(value)
}

/** Error codes a handler may surface to the renderer. */
export type IpcErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'NOT_IMPLEMENTED'
  | 'AI_NOT_CONFIGURED'
  | 'AI_UNAVAILABLE'
  | 'OFFLINE'
  | 'CANCELLED'
  | 'INTERNAL'

/** Error half of the envelope. `message` is safe to show to the user. */
export interface IpcError {
  code: IpcErrorCode
  message: string
}

/** Every invoke result. */
export type IpcEnvelope<T> = { ok: true; data: T } | { ok: false; error: IpcError }

/** Runtime check for envelope shape (preload uses it to guard what main returned). */
export function isIpcEnvelope(value: unknown): value is IpcEnvelope<unknown> {
  if (typeof value !== 'object' || value === null) return false
  const v = value as { ok?: unknown; error?: unknown }
  if (v.ok === true) return true
  if (v.ok !== false) return false
  const e = v.error as { code?: unknown; message?: unknown } | undefined
  return typeof e === 'object' && e !== null && typeof e.code === 'string' && typeof e.message === 'string'
}

/** `items:list` payload. */
export interface ItemsListRequest {
  view: ItemsView
  /** Required when `view === 'collection'`. */
  collectionId?: string
  types?: ItemType[]
  sort?: ItemsSort
  limit?: number
  offset?: number
}

/** `items:update` editable fields (sets `user_overrides`, re-indexes). */
export interface ItemUpdatePatch {
  title?: string
  understanding?: string
  whyUseful?: string
}

/** `capture:drop` payload: the raw dataTransfer snapshot, unclassified. */
export interface CaptureDropRequest {
  /** Absolute paths from `getPathForFile` (may be empty). */
  files: string[]
  /** Raw `text/uri-list`, if present. */
  uriList?: string
  /** Raw `text/plain`, if present. */
  text?: string
  /** Raw `text/html`, if present. */
  html?: string
  source: CaptureDropSource
  /** Add captured items to this collection. */
  collectionId?: string
}

/** `agent:command` payload (Ask, multi-item templates, ⌘K commands). */
export interface AgentCommandRequest {
  question: string
  itemIds?: string[]
  template?: CommandTemplate
  /** Prior turns for a follow-up question. Ask mode only; the renderer builds this from the previous run's Q&A. */
  history?: AgentCommandTurn[]
}

/** One turn of a prior Ask My Stuff exchange, fed back as context for a follow-up. */
export interface AgentCommandTurn {
  role: 'user' | 'assistant'
  content: string
}

/** `settings:testConnection` result. */
export interface TestConnectionResult {
  ok: boolean
  model: string
  latencyMs: number
  /** Present when `ok` is false: user-safe explanation. */
  error?: string
}

/** Request payload per channel (`void` = no payload). */
export interface IpcRequestMap {
  'items:list': ItemsListRequest
  'items:get': { id: string }
  'items:update': { id: string; patch: ItemUpdatePatch }
  'items:trash': { ids: string[] }
  'items:restore': { ids: string[] }
  'items:deleteForever': { ids: string[] }
  'items:reprocess': { id: string; from?: Stage }
  'items:reprocessAll': { from?: Stage }
  'items:openOriginal': { id: string }
  'items:revealInFinder': { id: string }
  'items:quickLook': { id: string }
  'items:openUrl': { id: string }
  'items:readContent': { id: string }
  'capture:files': { paths: string[]; mode?: CaptureMode }
  'capture:url': { url: string }
  'capture:text': { text: string; title?: string }
  'capture:blob': { name: string; mimeType: string; bytes: ArrayBuffer }
  'capture:drop': CaptureDropRequest
  'collections:list': void
  'collections:create': { name: string; description?: string }
  'collections:createDynamic': { name: string; description?: string; query: DynamicQuery }
  'collections:rename': { id: string; name: string; description?: string }
  'collections:delete': { id: string }
  'collections:addItems': { id: string; itemIds: string[] }
  'collections:removeItem': { id: string; itemId: string }
  'relationships:create': { sourceId: string; targetId: string; type: RelationshipType; description?: string }
  'relationships:remove': { id: string }
  'search:quick': { query: string; limit?: number }
  'agent:command': AgentCommandRequest
  'agent:cancel': { runId: string }
  'agent:run': { id: string }
  'agent:undo': { auditId: string }
  /** Revert every audited change of a run (newest first). */
  'agent:undoRun': { runId: string }
  /** Apply the staged proposals of a command run. */
  'agent:applyProposals': { runId: string }
  'settings:get': void
  'settings:update': SettingsPatch
  'settings:testConnection': void
  'system:stats': void
  'system:contextMenu': { kind: ContextMenuKind; ids: string[]; collectionId?: string }
  'system:openExternal': { url: string }
  'system:chooseFiles': void
  /** Reveal the library folder (`userData`) in Finder. */
  'system:revealLibrary': void
  'jobs:status': void
}

/** Response data per channel (`void` = no data; the envelope is still returned). */
export interface IpcResponseMap {
  'items:list': ItemSummary[]
  'items:get': ItemDetail
  'items:update': ItemDetail
  'items:trash': void
  'items:restore': void
  'items:deleteForever': void
  'items:reprocess': void
  'items:reprocessAll': { count: number }
  'items:openOriginal': void
  'items:revealInFinder': void
  'items:quickLook': void
  'items:openUrl': void
  'items:readContent': { markdown?: string; text?: string }
  'capture:files': CaptureResult
  'capture:url': CaptureResult
  'capture:text': CaptureResult
  'capture:blob': CaptureResult
  'capture:drop': CaptureResult
  'collections:list': CollectionSummary[]
  'collections:create': Collection
  'collections:createDynamic': Collection
  'collections:rename': void
  'collections:delete': void
  'collections:addItems': void
  'collections:removeItem': void
  'relationships:create': Relationship
  'relationships:remove': void
  'search:quick': SearchHit[]
  'agent:command': { runId: string }
  'agent:cancel': void
  'agent:run': AgentRunDetail
  'agent:undo': void
  'agent:undoRun': { undone: number }
  'agent:applyProposals': { applied: number; remaining: AgentProposal[] }
  'settings:get': Settings
  'settings:update': Settings
  'settings:testConnection': TestConnectionResult
  'system:stats': SystemStats
  'system:contextMenu': { action?: string }
  'system:openExternal': void
  'system:chooseFiles': { paths: string[] }
  'system:revealLibrary': void
  'jobs:status': JobProgress[]
}

export type IpcRequest<C extends IpcChannel> = IpcRequestMap[C]

export type IpcResponse<C extends IpcChannel> = IpcResponseMap[C]

/** Why `items:changed` fired. */
export type ItemsChangedReason = 'created' | 'updated' | 'trashed' | 'restored' | 'deleted'

/** `items:changed` payload. `summaries` is sent when main already has them (created/updated). */
export interface ItemsChangedEvent {
  reason: ItemsChangedReason
  ids: string[]
  summaries?: ItemSummary[]
}

/** `agent:run` payload: emitted on start (before the invoke resolves), after every step, at the end. */
export interface AgentRunEvent {
  runId: string
  task: AgentTask
  status: AgentRunStatus
  itemId?: string
  batchId?: string
  /** The step that just completed (step events only). */
  step?: AgentStep
  /** Final result (terminal `succeeded` event only). */
  result?: AgentResult
  /** Terminal `succeeded` only: the run wrote audit rows, so `agent:undoRun` can revert it. */
  undoable?: boolean
  /** Failure (terminal `failed` / `cancelled` events). */
  error?: IpcError
}

/** Payload per push event. */
export interface IpcEventMap {
  'items:changed': ItemsChangedEvent
  'jobs:progress': JobProgress
  'collections:changed': Record<string, never>
  'agent:run': AgentRunEvent
  'shelf:dropped': { result: CaptureResult }
  'settings:changed': { settings: Settings }
  'theme:changed': { theme: ResolvedTheme }
}

export type IpcEvent<E extends IpcEventName> = IpcEventMap[E]
