/**
 * Domain types shared by main, preload and renderer.
 *
 * Rules for this directory (`src/shared/**`): zero external imports (no node, no DOM, no zod,
 * no electron). Shared files may import each other (types and pure constants only). Row models
 * are camelCase mirrors of `storage/migrations/001-init.sql`; JSON columns are already parsed.
 * Timestamps are ISO-8601 UTC strings; ids are UUID v4 strings.
 */

import type { Kind } from './kinds'
import type { ProcessingStatus } from './status'

export type { Kind } from './kinds'
export type { ProcessingStatus } from './status'

/** Physical form of a captured object; drives the pipeline graph and the card body. */
export type ItemType =
  | 'file'
  | 'folder'
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'text'
  | 'markdown'
  | 'url'
  | 'note'
  | 'unknown'

/** Subtypes for `type = 'url'`, detected by the URL adapters. */
export type UrlSubtype =
  | 'article'
  | 'github_repo'
  | 'youtube'
  | 'tweet'
  | 'product'
  | 'docs'
  | 'paper'
  | 'figma'
  | 'social'
  | 'generic'

/** Subtypes for `type = 'image'`, detected by the image extractor heuristics. */
export type ImageSubtype = 'screenshot' | 'photo' | 'design' | 'generic'

/** Subtypes for `type = 'file'`, derived from mime type / extension. */
export type FileSubtype = 'document' | 'spreadsheet' | 'presentation' | 'archive' | 'code' | 'data' | 'other'

/** Union of every subtype; which ones are valid depends on `ItemType`. */
export type ItemSubtype = UrlSubtype | ImageSubtype | FileSubtype

/** Which item columns a user has edited by hand; the agent must not overwrite them. */
export type UserOverridableField = 'title' | 'understanding' | 'whyUseful' | 'kind' | 'topics' | 'entities'

/** `items.user_overrides` JSON: `{ title: true, understanding: true }`. */
export type UserOverrides = Partial<Record<UserOverridableField, boolean>>

/** Open Graph / page metadata captured for URL items. */
export interface OpenGraphMetadata {
  title?: string
  description?: string
  image?: string
  siteName?: string
  type?: string
  canonical?: string
}

/** GitHub repository facts shown on the repo card (`ItemSummary.card`). */
export interface RepoMetadata {
  owner?: string
  name?: string
  description?: string | null
  language?: string | null
  stars?: number
  forks?: number
  topics?: string[]
  defaultBranch?: string
  homepage?: string | null
  license?: string | null
  pushedAt?: string
}

/** Folder structure summary captured by the folder extractor. */
export interface FolderMetadata {
  fileCount: number
  dirCount: number
  totalBytes: number
  truncated: boolean
  extensions: Record<string, number>
  sampledFiles?: string[]
  tree?: string
}

/** Source reference stored on generated notes (`metadata.sources`). */
export interface NoteSource {
  itemId: string
  role: 'primary' | 'supporting'
  why: string
}

/**
 * `items.metadata` JSON. Known keys are typed; extractors may add more under the index
 * signature (exif, headings, oEmbed payloads, page-type guesses...).
 */
export interface ItemMetadata {
  og?: OpenGraphMetadata
  favicon?: string
  siteName?: string
  description?: string
  repo?: RepoMetadata
  folder?: FolderMetadata
  exif?: Record<string, unknown>
  headings?: string[]
  sources?: NoteSource[]
  /** Original URL an image/file was dragged from (browser drops). */
  sourceUrl?: string
  /** Filename at capture time (managed copies may be renamed for safety). */
  originalName?: string
  /** Extension-based hint when mime sniffing was inconclusive. */
  extension?: string
  [key: string]: unknown
}

/** Full `items` row in camelCase with JSON columns parsed. */
export interface Item {
  id: string
  type: ItemType
  subtype: ItemSubtype | null
  /** `Understanding.kind`; closed vocabulary from `kinds.ts`, queryable. */
  kind: Kind | null
  title: string
  /** Absolute path of the referenced original (import mode `reference`, or the source of a copy). */
  originalPath: string | null
  /** Path of the managed copy, relative to `<userData>/objects/`. */
  managedPath: string | null
  url: string | null
  canonicalUrl: string | null
  domain: string | null
  mimeType: string | null
  /** Size in bytes. */
  size: number | null
  /** sha256 hex of the original bytes. */
  contentHash: string | null
  width: number | null
  height: number | null
  durationMs: number | null
  pageCount: number | null
  createdAt: string
  capturedAt: string
  modifiedAt: string
  /** Bumped when the same object is captured again (duplicate detection). */
  lastKeptAt: string
  /** Items dropped together share a batch; drives `organize_batch`. */
  captureBatchId: string | null
  processingStatus: ProcessingStatus
  processingError: string | null
  understanding: string | null
  whyUseful: string | null
  topics: string[]
  entities: string[]
  /** visualDescription + visibleText from vision, joined. */
  visionText: string | null
  retrievalHints: string[]
  aiConfidence: number | null
  metadata: ItemMetadata
  /** Capped at `LIMITS.maxExtractedChars`. */
  extractedText: string | null
  /** ≤ `LIMITS.excerptChars`, shown on text cards. */
  excerpt: string | null
  /** Relative to `<userData>/thumbs/`. */
  thumbnailPath: string | null
  /** Relative to `<userData>/snapshots/`. */
  snapshotPath: string | null
  /** Relative to `<userData>/objects/`. */
  faviconPath: string | null
  /** CSS hex colour used to fill the card while media loads. */
  dominantColor: string | null
  /** Bumps whenever thumbnail/snapshot regenerate (media URL cache busting). */
  mediaVersion: number
  parentItemId: string | null
  userOverrides: UserOverrides
  isMissing: boolean
  missingCheckedAt: string | null
  deletedAt: string | null
}

/** Small preview facts for GitHub repo cards. */
export interface ItemCardFacts {
  language: string | null
  stars: number | null
  description: string | null
  owner: string | null
}

/**
 * Card payload for grids, lists and search results. All `*Url` fields are `ka-media://` URLs
 * built only in main (see `media.ts`); the renderer never constructs them.
 */
export interface ItemSummary {
  id: string
  type: ItemType
  subtype: ItemSubtype | null
  kind: Kind | null
  title: string
  domain: string | null
  url: string | null
  thumbnailUrl: string | null
  snapshotUrl: string | null
  faviconUrl: string | null
  dominantColor: string | null
  width: number | null
  height: number | null
  size: number | null
  mimeType: string | null
  durationMs: number | null
  pageCount: number | null
  excerpt: string | null
  capturedAt: string
  createdAt: string
  processingStatus: ProcessingStatus
  processingError: string | null
  /** Truncated to `LIMITS.summaryUnderstandingMaxChars`. */
  understanding: string | null
  collectionIds: string[]
  /** Folders: direct child items, or the manifest file count when the folder is a single item; 0 otherwise. */
  childCount: number
  /** Up to 4 child thumbnail URLs for the folder collage. */
  childThumbnailUrls: string[]
  card?: ItemCardFacts
  isMissing: boolean
  parentItemId: string | null
}

/** A relationship as seen from one item, with the other side resolved. */
export interface ItemDetailRelationship extends Relationship {
  /** `out` when this item is the source, `in` when it is the target. */
  direction: RelationshipDirection
  /** Human label for this direction (e.g. "inspired by" vs "inspired"). */
  label: string
  other: ItemSummary
}

/** Collection membership of one item, including why it was added. */
export interface ItemDetailCollection extends Collection {
  confidence: number | null
  reason: string | null
  addedBy: MembershipActor
  agentRunId: string | null
  addedAt: string
}

/** `items:get` payload. */
export interface ItemDetail {
  item: Item
  /** Card payload with the resolved media URLs (main builds them; the renderer cannot). */
  summary: ItemSummary
  /** `ka-media://` URL of the managed copy for the hero, null for referenced originals. */
  originalUrl: string | null
  relationships: ItemDetailRelationship[]
  collections: ItemDetailCollection[]
  latestRuns: AgentRunSummary[]
  /** Direct children for folders. */
  children?: ItemSummary[]
}

/** Sidebar views for `items:list`. */
export type ItemsView = 'library' | 'links' | 'files' | 'trash' | 'collection'

/** Sort keys for `items:list`. */
export type ItemsSort = 'captured' | 'created' | 'title'

/** How a collection is populated. */
export type CollectionType = 'manual' | 'ai' | 'dynamic'

/** Who created a collection. */
export type CollectionCreator = 'user' | 'agent'

/** Who added an item to a collection. */
export type MembershipActor = 'user' | 'agent' | 'dynamic'

/** Filters applied to searches and dynamic collections (dates on `captured_at`). */
export interface SearchFilters {
  types?: ItemType[]
  subtypes?: ItemSubtype[]
  kinds?: Kind[]
  domains?: string[]
  /** ISO timestamp, inclusive lower bound on `captured_at`. */
  since?: string
  /** ISO timestamp, exclusive upper bound on `captured_at`. */
  until?: string
  /** When true, type/kind cues are hard filters instead of soft boosts. */
  strict?: boolean
}

/** Stored query of a dynamic collection. */
export interface DynamicQuery {
  text: string
  filters: SearchFilters
  /** Cosine threshold on the item's summary embedding (chunk 0). */
  minCosine: number
}

/** `collections` row. */
export interface Collection {
  id: string
  name: string
  /** `normalizeName(name)`; unique. */
  nameKey: string
  description: string | null
  type: CollectionType
  query: DynamicQuery | null
  createdBy: CollectionCreator
  color: string | null
  pinned: boolean
  createdAt: string
  updatedAt: string
}

/** Sidebar / grid payload for a collection. */
export interface CollectionSummary extends Collection {
  count: number
  /** Up to 4 `ka-media://` thumbnail URLs for the cover collage. */
  coverThumbnailUrls: string[]
}

/** `collection_items` row. */
export interface CollectionItem {
  collectionId: string
  itemId: string
  confidence: number | null
  reason: string | null
  addedBy: MembershipActor
  agentRunId: string | null
  addedAt: string
}

/** Closed relationship vocabulary. Labels and symmetry live in `kinds.ts`. */
export type RelationshipType =
  | 'related_to'
  | 'inspired_by'
  | 'same_project'
  | 'references'
  | 'alternative_to'
  | 'continuation_of'
  | 'contradicts'
  | 'duplicate_of'
  | 'created_from'
  | 'belongs_to'

/** Direction of a relationship relative to a given item. */
export type RelationshipDirection = 'out' | 'in'

/** Who created a relationship. */
export type RelationshipCreator = 'user' | 'agent' | 'system'

/** Optional quote backing a relationship, verified against the target's text. */
export interface RelationshipEvidence {
  itemId: string
  quote: string
}

/** `relationships` row. Symmetric types are stored with `sourceItemId < targetItemId`. */
export interface Relationship {
  id: string
  sourceItemId: string
  targetItemId: string
  type: RelationshipType
  description: string | null
  confidence: number | null
  evidence: RelationshipEvidence | null
  createdBy: RelationshipCreator
  agentRunId: string | null
  createdAt: string
}

/** Chunk 0 is the memory document (`summary`); chunks ≥ 1 are body text (`body`). */
export type EmbeddingRole = 'summary' | 'body'

/** `embeddings` row without the vector BLOB. */
export interface EmbeddingMeta {
  itemId: string
  chunkIndex: number
  role: EmbeddingRole
  content: string
  model: string
  dims: number
}

/** Pipeline stages. Bodies live in `main/pipeline/stages/*`; the list itself is frozen. */
export type Stage =
  | 'extract'
  | 'thumbnail'
  | 'snapshot'
  | 'embed'
  | 'index'
  | 'understand'
  | 'relate'
  | 'organize_batch'
  | 'consolidate'

/** Scheduler lanes with fixed concurrency (`LIMITS.lanes`). */
export type Lane = 'io' | 'embed' | 'ai'

/** `jobs.status`. */
export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

/** `jobs` row. */
export interface Job {
  id: string
  itemId: string | null
  batchId: string | null
  stage: Stage
  lane: Lane
  priority: number
  status: JobStatus
  attempts: number
  /** Do not claim before this ISO timestamp (backoff / batch gate). */
  runAfter: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}

/** Per-job progress pushed by the scheduler (`jobs:progress`) and listed by `jobs:status`. */
export interface JobProgress {
  /** Null for batch-level jobs (`organize_batch`, `consolidate`). */
  itemId: string | null
  batchId: string | null
  /** Item status after this transition; null for batch-level jobs. */
  processingStatus: ProcessingStatus | null
  stage: Stage
  jobStatus: JobStatus
  attempts: number
  message?: string
}

/** Structured output of the `understand` task (validated by zod in `main/ai/schemas`). */
export interface Understanding {
  kind: Kind
  title: string
  /** One or two specific sentences: what this is and what it contains. */
  summary: string
  /** Why someone would keep this. */
  whyUseful: string
  topics: string[]
  entities: string[]
  /** Vision: what the image/page looks like. */
  visualDescription?: string
  /** Vision: legible text in the image. */
  visibleText?: string
  /** 3-6 phrases a person might type months later to find this. */
  retrievalHints: string[]
  /** 0..1 */
  confidence: number
}

/** Agent task kinds (`agent_runs.task`). */
export type AgentTask = 'understand' | 'organize' | 'organize_batch' | 'consolidate' | 'folder' | 'command'

/** `agent_runs.status`. */
export type AgentRunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled'

/** Coarse classification of a tool step for the activity view. */
export type AgentStepKind = 'search' | 'read' | 'inspect' | 'compare' | 'write' | 'finish'

/** One tool step of a run. `label` is product voice, never model reasoning. */
export interface AgentStep {
  n: number
  tool: string
  kind: AgentStepKind
  label: string
  itemIds?: string[]
  status: 'ok' | 'rejected'
  rejectReason?: string
  durationMs: number
}

/** Multi-item templates for `agent:command`. */
export type CommandTemplate = 'compare' | 'common' | 'summarize' | 'brief' | 'extract' | 'custom'

/** A cited source in an agent answer or note. */
export interface AgentSource {
  itemId: string
  role: 'primary' | 'supporting'
  why: string
}

/** Memory cues the agent extracted from a question (shown in the evidence header). */
export interface AgentCues {
  topics: string[]
  types: ItemType[]
  timeframe?: { since?: string; until?: string; label?: string }
}

/** Token usage of a run, summed over all model calls. */
export interface AgentUsage {
  promptTokens: number
  completionTokens: number
  calls: number
  latencyMs: number
}

/** Kinds of change the agent may stage through `propose_actions`. */
export type AgentProposalKind = 'add_to_collection' | 'create_collection' | 'relate' | 'tag' | 'rename' | 'trash'

/**
 * One staged change of a command run: everything needed to apply it later plus a product-voice
 * `label`. Persisted (unapplied ones) inside `agent_runs.result.proposals`, so approval survives a
 * restart. Applied through the domain services with audit rows; `trash` is only ever staged.
 */
export type AgentProposal = { label: string; confidence: number } & (
  | { kind: 'add_to_collection'; collectionId: string; itemId: string; reason: string }
  | { kind: 'create_collection'; name: string; description: string; itemIds: string[]; reason: string }
  | { kind: 'relate'; sourceId: string; targetId: string; type: RelationshipType; description: string }
  | { kind: 'tag'; itemId: string; topics: string[] }
  | { kind: 'rename'; itemId: string; title: string }
  | { kind: 'trash'; itemId: string; reason: string }
)

/** Result of a run, discriminated by task. Persisted as `agent_runs.result` JSON. */
export type AgentResult =
  | {
      task: 'command'
      kind: 'answer' | 'note'
      answer?: string
      noteId?: string
      sources: AgentSource[]
      cues: AgentCues
      confidence: number
      /** Staged, not yet applied (`agent:applyProposals`). Absent on runs from before this field. */
      proposals?: AgentProposal[]
      /** Changes an item-action run applied on its own (undo with `agent:undoRun`). */
      appliedCount?: number
    }
  | {
      task: 'understand'
      itemId: string
      understanding: Understanding
      /** Fields skipped because the user had overridden them. */
      skippedFields: UserOverridableField[]
    }
  | {
      task: 'organize'
      itemId: string
      relationshipIds: string[]
      collectionIds: string[]
      summary: string
    }
  | {
      task: 'organize_batch'
      batchId: string
      itemIds: string[]
      relationshipIds: string[]
      collectionIds: string[]
      summary: string
    }
  | {
      task: 'consolidate'
      renamedCollectionIds: string[]
      collectionIds: string[]
      relationshipIds: string[]
      summary: string
    }
  | {
      task: 'folder'
      itemId: string
      understanding: Understanding
      collectionId?: string
      summary: string
    }

/** List payload for runs (item detail "How this was organized"): steps included, result/usage not. */
export interface AgentRunSummary {
  id: string
  itemId: string | null
  batchId: string | null
  task: AgentTask
  status: AgentRunStatus
  model: string
  startedAt: string
  completedAt: string | null
  stepCount: number
  error: string | null
  /** Product-voice steps (never model reasoning). */
  steps: AgentStep[]
  /** True while the run has audited changes that have not been undone (`agent:undoRun`). */
  undoable: boolean
}

/** `agent:run` payload: full transcript without model reasoning. */
export interface AgentRunDetail extends AgentRunSummary {
  usage: AgentUsage | null
  result: AgentResult | null
}

/** Why a hit ranked where it did (drives evidence headers and tests). */
export interface SearchEvidence {
  /** Normalized bm25 (0..1, higher is better). */
  bm25Norm?: number
  cosine?: number
  /** FTS columns that matched (e.g. `title`, `retrieval_hints`). */
  matchedFields: string[]
}

/** One retrieval hit; also the candidate shape handed to the agent. */
export interface SearchHit {
  id: string
  title: string
  type: ItemType
  subtype: ItemSubtype | null
  kind: Kind | null
  domain: string | null
  capturedAt: string
  /** `relativeTime(capturedAt)` computed in main. */
  capturedAgo: string
  /** Truncated to 140 chars. */
  understanding: string | null
  snippet?: string
  thumbnailUrl?: string | null
  evidence: SearchEvidence
  score: number
}

/** Same shape as `SearchHit`; the name marks agent-side candidate lists. */
export type Candidate = SearchHit

/** Import mode for files: copy into `objects/` or reference the original path. */
export type CaptureMode = 'copy' | 'reference'

/** Where a drop came from (`capture:drop`). */
export type CaptureDropSource = 'library' | 'shelf'

/** Every capture entry point, for audit and metadata. */
export type CaptureSource = CaptureDropSource | 'paste' | 'dialog' | 'shortcut' | 'api'

/** Outcome for one captured object. */
export interface CaptureResultItem {
  id: string
  status: 'created' | 'duplicate'
  /** Set when `status === 'duplicate'`: the item that already holds this object. */
  existingId?: string
  title: string
}

export interface CaptureResult {
  items: CaptureResultItem[]
  batchId: string
}

/** Which AI provider drives the agent. */
export type AiMode = 'gmi' | 'mock' | 'off'

/** Runtime AI connectivity as shown in the footer. */
export type AiStatus = 'off' | 'connected' | 'offline' | 'unconfigured'

/** User theme preference. */
export type Theme = 'system' | 'light' | 'dark'

/** Effective theme after resolving `system`. */
export type ResolvedTheme = 'light' | 'dark'

/** Which embedding backend is active. */
export type EmbeddingProviderId = 'minilm' | 'local-hash' | 'none'

/** `settings:get` payload. Never contains the plain API key. */
export interface Settings {
  aiMode: AiMode
  model: string
  baseUrl: string
  hasApiKey: boolean
  /** e.g. `sk-…9f3a`; null when no key is stored. */
  apiKeyMasked: string | null
  importMode: CaptureMode
  theme: Theme
  /** Absolute path of the library (`userData`). */
  libraryPath: string
  embeddings: {
    provider: EmbeddingProviderId
    modelPresent: boolean
    dims: number
  }
}

/** `settings:update` payload; `apiKey` is plain text and is encrypted at rest by main. */
export interface SettingsPatch {
  apiKey?: string
  clearApiKey?: boolean
  aiMode?: AiMode
  model?: string
  baseUrl?: string
  importMode?: CaptureMode
  theme?: Theme
}

/** `system:stats` payload. */
export interface SystemStats {
  items: number
  connections: number
  collections: number
  /** Items currently not READY/PARTIAL. */
  processing: number
  aiStatus: AiStatus
}

/** Which native context menu to show. */
export type ContextMenuKind = 'item' | 'items' | 'collection' | 'background'

/** Who performed an audited mutation. */
export type AuditActor = 'user' | 'agent' | 'system' | 'dynamic'

/** `audit_log` row. */
export interface AuditEntry {
  id: string
  actor: AuditActor
  action: string
  entity: string
  entityId: string
  before: unknown
  after: unknown
  agentRunId: string | null
  createdAt: string
  undoneAt: string | null
}

/** `suppressions.kind`: facts the agent must never re-create after a user removed them. */
export type SuppressionKind = 'relationship' | 'collection_member' | 'dynamic_member'
