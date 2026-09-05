/** TypeScript interfaces for every seam between layers. */

import type { AgentCommandRequest, AgentRunEvent, CaptureDropRequest, ItemsChangedEvent } from '../shared/ipc'
import type { StageOutcome } from '../shared/status'
import type {
  AgentProposal,
  AgentRunDetail,
  AiStatus,
  Candidate,
  CaptureMode,
  CaptureResult,
  CaptureSource,
  CollectionSummary,
  Item,
  JobProgress,
  Lane,
  SearchFilters,
  SearchHit,
  Settings,
  Stage
} from '../shared/types'

/** Structured fields attached to a log line. Secrets are redacted by the logger. */
export type LogFields = Record<string, unknown>

/** JSON-lines logger with child scopes (`lib/logger.ts`). */
export interface Logger {
  debug(msg: string, fields?: LogFields): void
  info(msg: string, fields?: LogFields): void
  warn(msg: string, fields?: LogFields): void
  error(msg: string, fields?: LogFields): void
  /** New logger that merges `fields` into every line. */
  child(fields: LogFields): Logger
}

/** Injected clock so schedulers and backoff are testable. */
export interface Clock {
  now(): Date
  /** `now().toISOString()`. */
  nowIso(): string
}

/** Absolute paths of the library layout under `userData` (`storage/paths.ts`). */
export interface Paths {
  userData: string
  /** `<userData>/library.db` */
  dbFile: string
  /** Managed copies: `objects/<itemId>/<safe-name>` */
  objectsDir: string
  /** `thumbs/<itemId>.png` */
  thumbsDir: string
  /** `snapshots/<itemId>.jpg` */
  snapshotsDir: string
  /** Generated notes: `content/<itemId>.md` */
  contentDir: string
  /** Seeded embedding model files (Hugging Face hub layout). */
  modelsDir: string
  logsDir: string
  /** Extraction results cached by canonical URL. */
  urlCacheDir: string
  /** Packaged `Contents/Resources/models` to seed `modelsDir` from; absent in dev when not fetched. */
  resourcesModelsDir?: string
}

/** Encrypted at-rest key/value store backed by `safeStorage` (`lib/config.ts`). */
export interface SecretStore {
  get(key: string): string | null
  set(key: string, value: string): void
  delete(key: string): void
  /** False when the OS keychain/encryption backend is unavailable (values are then not persisted). */
  available(): boolean
}

/** In-process domain events (`core/events.ts`). IPC `events.ts` forwards the relevant ones. */
export interface DomainEventMap {
  'item.created': ItemsChangedEvent
  'item.updated': ItemsChangedEvent
  'item.trashed': ItemsChangedEvent
  'item.restored': ItemsChangedEvent
  'item.deleted': ItemsChangedEvent
  /** An item reached a settled status or was (re)indexed; dynamic collections re-materialize. */
  'item.indexed': { itemId: string }
  'job.progress': JobProgress
  'agent.run': AgentRunEvent
  'collections.changed': Record<string, never>
  'settings.changed': { settings: Settings }
  'ai.status': { status: AiStatus }
}

export type DomainEventName = keyof DomainEventMap

/** Typed synchronous event bus. Listeners must not throw; errors are logged, never propagated. */
export interface EventBus {
  on<E extends DomainEventName>(event: E, listener: (payload: DomainEventMap[E]) => void): () => void
  off<E extends DomainEventName>(event: E, listener: (payload: DomainEventMap[E]) => void): void
  emit<E extends DomainEventName>(event: E, payload: DomainEventMap[E]): void
}

/** Options shared by every capture entry point. */
export interface CaptureOptions {
  source: CaptureSource
  /** Add the captured items to this collection. */
  collectionId?: string
  /** Reuse an existing batch id (items dropped together share one). */
  batchId?: string
}

/** Bytes without a disk path (clipboard images, browser `File` objects). */
export interface BlobPayload {
  name: string
  mimeType: string
  bytes: ArrayBuffer | Uint8Array
}

/** Capture entry points (`capture/intake.ts`). Owns dedupe, import mode and ALL drop classification. */
export interface Intake {
  captureFiles(paths: string[], mode?: CaptureMode, opts?: CaptureOptions): Promise<CaptureResult>
  captureUrl(url: string, opts?: CaptureOptions): Promise<CaptureResult>
  captureText(text: string, title?: string, opts?: CaptureOptions): Promise<CaptureResult>
  captureBlob(payload: BlobPayload, opts?: CaptureOptions): Promise<CaptureResult>
  /** Raw dataTransfer snapshot from the renderer; precedence rules live here. */
  captureDrop(payload: CaptureDropRequest): Promise<CaptureResult>
}

/** Options for the instant (no LLM) search path. */
export interface QuickSearchOptions {
  limit?: number
}

/** A collection an item might belong to, ranked by centroid similarity. */
export interface CollectionCandidate {
  collection: CollectionSummary
  /** Cosine between the item's summary vector and the collection centroid. */
  cosine: number
  /** Up to 3 members closest to the item. */
  nearestMembers: Candidate[]
}

/** FTS + vector retrieval over the library (`retrieval/index.ts`). */
export interface Retrieval {
  /** Palette path: fused FTS + vector hits, no LLM, target < 50 ms. */
  quickSearch(query: string, opts?: QuickSearchOptions): Promise<SearchHit[]>
  /** Hybrid search with filters (agent `search_library`). */
  search(query: string, filters: SearchFilters, k: number): Promise<Candidate[]>
  /** Vector-only search (agent `semantic_search`). */
  semantic(query: string, k: number, filters?: SearchFilters): Promise<Candidate[]>
  /** Nearest items by summary vector (chunk 0), excluding the item itself. */
  similarItems(itemId: string, k: number): Promise<Candidate[]>
  /** Rebuild FTS row + summary embedding for one item (the `index` stage). */
  indexItem(itemId: string): Promise<void>
  /** Drop an item from FTS and the vector matrix. */
  removeItem(itemId: string): Promise<void>
  /** Embed arbitrary texts with the active provider (normalized vectors). */
  embedTexts(texts: string[]): Promise<Float32Array[]>
  /** Collections the item might join, by centroid cosine. */
  collectionCandidates(itemId: string, k: number): Promise<CollectionCandidate[]>
  /** Load the vector matrix / warm the embedding worker at startup. */
  warm(): Promise<void>
}

/** Who started a run. */
export type AgentActor = 'user' | 'system'

/** Agent orchestration (`agent/index.ts`). Runs are asynchronous; progress arrives via `agent.run`. */
export interface AgentService {
  /** Ask / multi-item template / ⌘K command. Resolves after the `running` event was emitted. */
  command(input: AgentCommandRequest, actor?: AgentActor): Promise<{ runId: string }>
  cancel(runId: string): void
  getRun(runId: string): AgentRunDetail | null
  /** Revert one audited mutation (applies `before`, writes suppression for agent facts). */
  undo(auditId: string): void
  /** Revert every audited mutation of a run (newest first). Returns how many were undone. */
  undoRun(runId: string): number
  /** Staged proposals of a command run that are still waiting for approval. */
  proposals(runId: string): AgentProposal[]
  /** Apply the staged proposals through the services (audited); the rest stay staged. */
  applyProposals(runId: string): { applied: number; remaining: AgentProposal[] }
}

/** Text part of a multimodal message. */
export interface TextContentPart {
  type: 'text'
  text: string
}

/** Image part of a multimodal message (`data:` URI or https URL). */
export interface ImageContentPart {
  type: 'image_url'
  image_url: { url: string; detail?: 'low' | 'high' | 'auto' }
}

export type ContentPart = TextContentPart | ImageContentPart

/** A tool invocation requested by the model. `arguments` is a JSON string (possibly malformed). */
export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface SystemMessage {
  role: 'system'
  content: string
}

/** User message; may carry images. */
export interface UserMessage {
  role: 'user'
  content: string | ContentPart[]
}

/** Assistant turn; may carry tool calls and provider reasoning (never persisted or sent to the UI). */
export interface AssistantMessage {
  role: 'assistant'
  content: string | null
  tool_calls?: ToolCall[]
  reasoning_content?: string
}

/** Tool result fed back to the model. */
export interface ToolMessage {
  role: 'tool'
  tool_call_id: string
  content: string
}

export type ChatMessage = SystemMessage | UserMessage | AssistantMessage | ToolMessage

/** JSON object (JSON Schema documents, tool parameters). */
export type JsonObject = Record<string, unknown>

/** Function tool definition in OpenAI shape. */
export interface ToolSpec {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: JsonObject
  }
}

export type ToolChoice = 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } }

/** Requested output format. MiniMax does not enforce `json_schema`; callers still extract + validate. */
export type ResponseFormat = { type: 'json_object' } | { type: 'json_schema'; json_schema: JsonObject }

export interface ChatRequest {
  messages: ChatMessage[]
  tools?: ToolSpec[]
  toolChoice?: ToolChoice
  maxTokens?: number
  temperature?: number
  topP?: number
  responseFormat?: ResponseFormat
  /** Overrides the provider default (`LIMITS.aiTimeoutMs`). */
  timeoutMs?: number
  signal?: AbortSignal
  /** Task name for usage logging (`understand`, `organize`, `command`...). */
  task?: string
}

/** Token usage and latency of one call. */
export interface Usage {
  promptTokens: number
  completionTokens: number
  totalTokens?: number
  latencyMs: number
}

/** Why generation stopped. `length` = truncated; callers must not parse the content. */
export type FinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'unknown'

export interface ChatResponse {
  id?: string
  model: string
  message: AssistantMessage
  finishReason: FinishReason
  usage: Usage
  /** Provider payload for debugging/record mode; never persisted with the run. */
  raw?: unknown
}

/** Validator for structured output. A zod schema satisfies this structurally (`schema.parse`). */
export interface StructuredSchema<T> {
  /** Throws on invalid input; the error message is fed back to the model on retry. */
  parse(value: unknown): T
  /** Name used in the prompt / `json_schema` response format. */
  name?: string
  /** JSON Schema shown to the model. */
  jsonSchema?: JsonObject
}

/** Reasoning model behind the agent (`ai/provider.ts`). Implementations: gmi-minimax, mock, scripted, cache. */
export interface AIProvider {
  /** Provider id: `gmi`, `mock`, `scripted`, `cache`. */
  readonly id: string
  readonly model: string
  chat(req: ChatRequest): Promise<ChatResponse>
  /** One structured call: extract JSON, validate with `schema`, retry once with the error. */
  generateStructured<T>(schema: StructuredSchema<T>, req: ChatRequest): Promise<{ value: T; usage: Usage }>
}

/** Local embedding backend (`ai/embeddings/index.ts`): MiniLM in the worker or the hash fallback. */
export interface EmbeddingProvider {
  /** `minilm` | `local-hash`. */
  readonly id: string
  /** Stored in `embeddings.model`; vectors are only compared within one model. */
  readonly model: string
  readonly dims: number
  /** L2-normalized vectors, one per input, in order. */
  embed(texts: string[]): Promise<Float32Array[]>
  /** True once the model is loaded (or the fallback is active). */
  ready(): Promise<boolean>
}

/** Pixel size of a written preview image. */
export interface PreviewSize {
  width: number
  height: number
}

/** Thumbnail generation (`previews/thumbnails.ts`: qlmanage / nativeImage). */
export interface Thumbnailer {
  /** Writes a PNG ≤ `maxPx` on the longest side; null when no preview could be made. */
  thumbnail(filePath: string, outPath: string, maxPx: number, signal?: AbortSignal): Promise<PreviewSize | null>
  /** JPEG (quality 80) with the longest side ≤ `maxPx`, for the understand task's `image_url`. */
  visionImage(filePath: string, outPath: string, maxPx: number, signal?: AbortSignal): Promise<PreviewSize | null>
  /** `#rrggbb` of the dominant colour of an image file; null when unreadable. */
  dominantColorOf(imagePath: string): Promise<string | null>
}

export interface SnapshotOptions {
  signal?: AbortSignal
  /** Also write a full-page JPEG here when it fits the size cap. */
  fullPagePath?: string
}

export interface SnapshotResult extends PreviewSize {
  title?: string
  /** Rendered HTML for extraction (capped). */
  html?: string
  finalUrl?: string
  dominantColor?: string
  fullPage?: { path: string; width: number; height: number; bytes: number }
}

/** URL page snapshot via an offscreen window (`previews/snapshot.ts`). */
export interface Snapshotter {
  /** Writes a PNG to `outPath`; may also return title, HTML and an optional full-page JPEG. */
  snapshot(url: string, outPath: string, opts?: SnapshotOptions): Promise<SnapshotResult | null>
  /** Destroys the offscreen window. */
  dispose(): void
}

/** HTML acquisition (`extraction/url/fetch.ts` + `desktop/dom-fallback.ts`). */
export interface PageFetcher {
  /** Plain HTTP fetch with browser UA and timeout; null on network failure. */
  fetchHtml(url: string): Promise<{ status: number; finalUrl: string; contentType: string; html: string } | null>
  /** Rendered DOM from an offscreen window for JS-heavy pages; null on failure/timeout. */
  fetchDom(url: string): Promise<{ html: string; title: string; finalUrl: string } | null>
}

export interface WorkerCallOptions {
  timeoutMs?: number
  signal?: AbortSignal
}

/** Client for the utility-process worker (`lib/worker-client.ts`): lazy spawn, restart on crash. */
export interface WorkerClient {
  call<T>(task: string, payload: unknown, opts?: WorkerCallOptions): Promise<T>
  terminate(): void
}

/** Item columns a stage may set through `StagePatch.item`. Status, timestamps and ownership are off-limits. */
export type StagePatchableColumn =
  | 'title'
  | 'subtype'
  | 'kind'
  | 'url'
  | 'canonicalUrl'
  | 'domain'
  | 'mimeType'
  | 'size'
  | 'contentHash'
  | 'width'
  | 'height'
  | 'durationMs'
  | 'pageCount'
  | 'managedPath'
  | 'processingError'
  | 'understanding'
  | 'whyUseful'
  | 'topics'
  | 'entities'
  | 'visionText'
  | 'retrievalHints'
  | 'aiConfidence'
  | 'extractedText'
  | 'excerpt'
  | 'thumbnailPath'
  | 'snapshotPath'
  | 'faviconPath'
  | 'dominantColor'
  | 'mediaVersion'

/** What a stage returns; the scheduler applies it in one transaction with the job/status update. */
export interface StagePatch {
  item?: Partial<Pick<Item, StagePatchableColumn>>
  /** Merged into `items.metadata` with `json_patch` (null values delete keys). */
  metadataPatch?: Record<string, unknown>
  outcome: StageOutcome
  /** User-facing note (product voice), surfaced via `jobs:progress`. */
  message?: string
  /** Technical error for logs / `processing_error`. */
  error?: string
  /** Extra stages to enqueue beyond the graph (e.g. `snapshot` after a redirect to a PDF). */
  followUp?: Stage[]
}

/**
 * Services available to stage bodies. All optional so the foundation can wire what exists and
 * slices can widen (declaration merging or the index signature) without touching this file.
 */
export interface StageDeps {
  retrieval?: Retrieval
  ai?: AIProvider
  embeddings?: EmbeddingProvider
  thumbnailer?: Thumbnailer
  snapshotter?: Snapshotter
  pageFetcher?: PageFetcher
  worker?: WorkerClient
  agent?: AgentService
  events?: EventBus
  /** Repositories keyed by name (`items`, `collections`, `relationships`, `embeddings`, `agentRuns`, `jobs`, `audit`, `suppressions`). */
  repos?: Record<string, unknown>
  [extra: string]: unknown
}

export interface StageContext {
  /** Absent for batch-level stages (`organize_batch`, `consolidate`). */
  itemId?: string
  batchId?: string
  /** Fresh row at claim time (absent for batch-level stages). */
  item?: Item
  paths: Paths
  logger: Logger
  clock: Clock
  /** Aborted on cancel (trash/delete), timeout or shutdown. */
  signal: AbortSignal
  deps: StageDeps
}

/** One pipeline stage (`pipeline/stages/*`). Bodies must be idempotent and never write `items` directly. */
export interface StageDefinition {
  name: Stage
  lane: Lane
  timeoutMs: number
  run(ctx: StageContext): Promise<StagePatch>
}
