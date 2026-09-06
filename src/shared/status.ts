/**
 * Item processing lifecycle: statuses, user-facing stage groups, copy, and the pure transition
 * table used by the pipeline scheduler.
 *
 * Zero imports allowed in `src/shared/**` (types from sibling files only).
 */

import type { Stage } from './types'

/** Every `items.processing_status` value. */
export const PROCESSING_STATUSES = [
  'CAPTURED',
  'EXTRACTING',
  'EXTRACTED',
  'EMBEDDING',
  'UNDERSTANDING',
  'RELATING',
  'READY',
  'PARTIAL',
  'EXTRACTION_FAILED',
  'AI_FAILED',
  'WAITING_FOR_AI'
] as const

/** One of `PROCESSING_STATUSES`. */
export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number]

export function isProcessingStatus(value: unknown): value is ProcessingStatus {
  return typeof value === 'string' && (PROCESSING_STATUSES as readonly string[]).includes(value)
}

/** Failure statuses (the item is still kept; the card offers "Try again"). */
export function isFailed(status: ProcessingStatus): boolean {
  return status === 'EXTRACTION_FAILED' || status === 'AI_FAILED'
}

/** No further automatic processing is pending (`READY`, `PARTIAL`). */
export function isTerminal(status: ProcessingStatus): boolean {
  return status === 'READY' || status === 'PARTIAL'
}

/** Ids of the three coarse stages a user sees while an item is being processed. */
export type UserStageId = 'reading' | 'understanding' | 'connecting'

/** A user-facing progress step grouping several internal statuses. */
export interface UserStage {
  id: UserStageId
  label: string
  statuses: readonly ProcessingStatus[]
}

/** Coarse progress steps shown on cards (`reading -> understanding -> connecting`). */
export const USER_STAGES: readonly UserStage[] = [
  { id: 'reading', label: 'Reading', statuses: ['EXTRACTING', 'EXTRACTED', 'EMBEDDING'] },
  { id: 'understanding', label: 'Understanding', statuses: ['UNDERSTANDING'] },
  { id: 'connecting', label: 'Looking for similar things', statuses: ['RELATING'] }
]

/** The user-facing stage a status belongs to, or null for settled/failed/waiting/captured states. */
export function userStageFor(status: ProcessingStatus): UserStage | null {
  return USER_STAGES.find((stage) => stage.statuses.includes(status)) ?? null
}

/** Card copy per status, in the brief's voice. Empty string = show nothing. */
export const STATUS_LABEL: Record<ProcessingStatus, string> = {
  CAPTURED: 'Saved.',
  EXTRACTING: 'Reading',
  EXTRACTED: 'Reading',
  EMBEDDING: 'Reading',
  UNDERSTANDING: 'Understanding',
  RELATING: 'Looking for similar things',
  READY: '',
  PARTIAL: 'Kept. Partly understood.',
  EXTRACTION_FAILED: "Couldn't read this, but it's kept.",
  AI_FAILED: 'Still figuring this one out.',
  WAITING_FOR_AI: 'Kept. Not understood yet.'
}

/** Copy for each pipeline stage (activity views, job lists). */
export const STAGE_LABEL: Record<Stage, string> = {
  extract: 'Reading',
  thumbnail: 'Making a preview',
  snapshot: 'Capturing the page',
  embed: 'Indexing',
  index: 'Indexing',
  understand: 'Understanding',
  relate: 'Looking for similar things',
  organize_batch: 'Organizing',
  consolidate: 'Tidying collections'
}

/** How a stage body ended. `partial` = it worked, but on incomplete input or with gaps. */
export type StageOutcome = 'ok' | 'partial' | 'failed'

/** Optional facts only the scheduler knows when applying a transition. */
export interface TransitionContext {
  /**
   * True when the graph has no further stage for this item after `stage` (e.g. `index` for notes,
   * which skip understand/relate). Lets stages that normally leave the status alone settle it.
   */
  isLast?: boolean
}

/**
 * Statuses that carry "not fully understood" memory. The scheduler does not overwrite them with a
 * stage's running status (see `stageEntryStatus`), so `next()` can turn them into `PARTIAL` at the
 * end instead of `READY`.
 */
export const STICKY_STATUSES: readonly ProcessingStatus[] = ['EXTRACTION_FAILED', 'PARTIAL']

/** Statuses that mean "extraction has not completed yet" (embed may move them forward). */
const BEFORE_UNDERSTANDING: readonly ProcessingStatus[] = ['CAPTURED', 'EXTRACTING', 'EXTRACTED', 'EMBEDDING']

/** Settle an item after its last stage: sticky/partial inputs end `PARTIAL`, everything else `READY`. */
function settle(status: ProcessingStatus, outcome: StageOutcome): ProcessingStatus {
  if (outcome === 'partial') return 'PARTIAL'
  if (STICKY_STATUSES.includes(status)) return 'PARTIAL'
  return 'READY'
}

/**
 * Pure transition table. `status` is the item's *current* status when the stage finishes (normally
 * the value `stageEntryStatus()` set at claim time, or a sticky status that was left in place).
 *
 * Rules:
 * - `extract`: ok/partial -> `EXTRACTED`; failed -> `EXTRACTION_FAILED` (the item still proceeds to
 *   understanding on metadata only and ends `PARTIAL`).
 * - `thumbnail` / `snapshot`: never change the status, unless `ctx.isLast` (then settle).
 * - `embed`: ok/partial -> `UNDERSTANDING` when the item has not reached understanding yet, otherwise
 *   unchanged; failed -> unchanged (the job retries; embeddings are not required to proceed).
 * - `index`: unchanged, unless `ctx.isLast` (notes: ok -> `READY`, partial/failed -> `PARTIAL`).
 * - `understand`: ok -> `RELATING` (from `EXTRACTION_FAILED` -> `PARTIAL`, keeping the memory that only
 *   metadata was understood); partial -> `PARTIAL`; failed -> `AI_FAILED`.
 * - `relate` / `organize_batch`: ok -> `READY` (`PARTIAL` when the status was sticky); partial ->
 *   `PARTIAL`; failed -> `AI_FAILED`.
 * - `consolidate`: batch-level, never changes an item's status.
 * - `WAITING_FOR_AI` is set directly by the scheduler when it parks ai-lane jobs (no key / offline);
 *   the resumed stage then transitions from it like from its own running status.
 */
export function next(
  status: ProcessingStatus,
  stage: Stage,
  outcome: StageOutcome,
  ctx: TransitionContext = {}
): ProcessingStatus {
  switch (stage) {
    case 'extract':
      return outcome === 'failed' ? 'EXTRACTION_FAILED' : 'EXTRACTED'
    case 'thumbnail':
    case 'snapshot':
    case 'index':
      if (ctx.isLast) return outcome === 'failed' ? 'PARTIAL' : settle(status, outcome)
      return status
    case 'embed':
      if (outcome === 'failed') return status
      return BEFORE_UNDERSTANDING.includes(status) ? 'UNDERSTANDING' : status
    case 'understand':
      if (outcome === 'failed') return 'AI_FAILED'
      if (outcome === 'partial') return 'PARTIAL'
      return status === 'EXTRACTION_FAILED' ? 'PARTIAL' : 'RELATING'
    case 'relate':
    case 'organize_batch':
      if (outcome === 'failed') return 'AI_FAILED'
      return settle(status, outcome)
    case 'consolidate':
      return status
  }
}

/** Nominal status an item shows while a stage runs; null for stages that leave the status alone. */
const RUNNING_STATUS: Partial<Record<Stage, ProcessingStatus>> = {
  extract: 'EXTRACTING',
  embed: 'EMBEDDING',
  understand: 'UNDERSTANDING',
  relate: 'RELATING',
  organize_batch: 'RELATING'
}

/**
 * Position of each status along the flow. Used so a running status never moves an item backwards
 * (e.g. `embed` finishing after `understand` must not turn `RELATING` into `EMBEDDING`).
 * `AI_FAILED` / `WAITING_FOR_AI` sit at the understanding step: ai stages resume over them, `embed` does not touch them.
 */
const FLOW_RANK: Record<ProcessingStatus, number> = {
  CAPTURED: 0,
  EXTRACTING: 1,
  EXTRACTED: 2,
  EXTRACTION_FAILED: 2,
  EMBEDDING: 3,
  UNDERSTANDING: 4,
  AI_FAILED: 4,
  WAITING_FOR_AI: 4,
  RELATING: 5,
  READY: 6,
  PARTIAL: 6
}

/**
 * Status an item is in WHILE `stage` runs (`extract -> EXTRACTING`, `embed -> EMBEDDING`,
 * `understand -> UNDERSTANDING`, `relate`/`organize_batch -> RELATING`; others -> null = unchanged).
 *
 * With `current` given the scheduler gets the safe answer for the item's actual state:
 * - `extract` always restarts the flow (`EXTRACTING`).
 * - sticky statuses (`EXTRACTION_FAILED`, `PARTIAL`) are never overwritten, so their memory survives
 *   until `next()` settles the item;
 * - a running status never moves the item backwards (`embed` over `RELATING`/`READY` -> null,
 *   `relate` over `READY` -> null); `AI_FAILED`/`WAITING_FOR_AI` resume into `UNDERSTANDING`/`RELATING`.
 * `items:reprocess` resets the status explicitly before enqueueing, so it is unaffected by these rules.
 */
export function stageEntryStatus(stage: Stage, current?: ProcessingStatus): ProcessingStatus | null {
  const running = RUNNING_STATUS[stage]
  if (!running) return null
  if (!current || stage === 'extract') return running
  if (STICKY_STATUSES.includes(current)) return null
  if (FLOW_RANK[current] > FLOW_RANK[running]) return null
  return running
}
