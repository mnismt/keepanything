import { LIMITS } from '../../shared/constants'
import type { Item, Stage } from '../../shared/types'
import type { Clock, Logger, PageFetcher, WorkerClient } from '../ports'

/**
 * Extraction contract. Adapters are pure: no `electron`, no `process.env`; everything
 * that touches the network or the worker arrives through `ExtractionDeps`.
 */

export const EXTRACTION_BUDGET = {
  /** `items.extracted_text` cap (mirrors `LIMITS.maxExtractedChars`). */
  maxChars: LIMITS.maxExtractedChars,
  /** Markdown/text written to `content/<id>.md` may be longer than the column. */
  contentFileChars: 200_000,
  /** Largest text file read whole (bytes). */
  maxTextFileBytes: 2_000_000,
  /** PDF pages read before giving up on more text. */
  pdfMaxPages: 80,
  /** HTML kept from a fetch (chars). */
  htmlMaxChars: 5_000_000,
  /** Largest download accepted for a PDF/image URL (bytes). */
  maxDownloadBytes: 60_000_000,
  /** Readable characters below which a fetched page is considered JS-rendered. */
  readableThreshold: 400,
  /** GitHub README characters kept. */
  githubReadmeChars: 4_000,
  /** Timeout for one network request (ms). */
  fetchTimeoutMs: 20_000
} as const

export interface ExtractedContent {
  /** Plain text for FTS / the understand task (capped at `maxChars` by the stage). */
  text: string
  /** Markdown body when the source has structure (readable article, README, notes). */
  markdown?: string
  /** Better title than the capture-time one, when the source knows it. */
  title?: string
  /** Merged into `items.metadata` (`json_patch`; null deletes). */
  meta: Record<string, unknown>
  pageCount?: number
  /** Pixel size for images, page-1 size in points for PDFs. */
  dims?: { width: number; height: number }
  /** True when text was cut to fit the budget. */
  truncated: boolean
  /** True when only part of the source could be read (metadata only, listing only...). */
  partial?: boolean
  /** Technical reason for `partial` (never shown to users verbatim). */
  error?: string
  /** Column overrides the stage forwards into the `StagePatch` (subtype, mime, managed copy...). */
  item?: Partial<
    Pick<
      Item,
      | 'subtype'
      | 'mimeType'
      | 'managedPath'
      | 'size'
      | 'contentHash'
      | 'url'
      | 'canonicalUrl'
      | 'domain'
      | 'durationMs'
      | 'faviconPath'
    >
  >
  /** Extra stages the source unlocked (e.g. `thumbnail` once a URL turned out to be a PDF). */
  followUp?: Stage[]
}

/** `fetch`-compatible function so tests can stub the network. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** Minimal object-store surface the URL adapters need to keep downloaded PDFs. */
export interface ExtractionObjectStore {
  writeBytes(
    itemId: string,
    name: string,
    bytes: Uint8Array
  ): Promise<{ managedPath: string; size: number; sha256: string }>
  /** Absolute path for a `managedPath` (lets the worker read the stored file). */
  resolve?(managedPath: string): string
}

/** Everything an adapter may use. All network/worker access goes through here. */
export interface ExtractionDeps {
  logger: Logger
  clock: Clock
  signal?: AbortSignal
  fetchImpl?: FetchLike
  worker?: WorkerClient
  pageFetcher?: PageFetcher
  /** Fetched HTML cached by canonical URL so retries work offline. */
  urlCacheDir?: string
  objectStore?: ExtractionObjectStore
}

export interface ExtractionSource {
  item: Item
  /** Absolute path of the bytes (managed copy first, original second); null for URLs. */
  filePath: string | null
}

export interface Extractor {
  id: string
  extract(source: ExtractionSource, deps: ExtractionDeps): Promise<ExtractedContent>
}

export function emptyContent(meta: Record<string, unknown> = {}): ExtractedContent {
  return { text: '', meta, truncated: false }
}

/** Collapse whitespace and cap; used for excerpts and titles. */
export function squash(text: string, max: number): string {
  const s = text.replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s
}

/** Cut `text` to `max` chars, reporting whether anything was dropped. */
export function capText(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false }
  return { text: text.slice(0, max), truncated: true }
}

/** Throw a `CANCELLED`-flavoured error when the signal fired (stage bodies must stop promptly). */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error('Extraction cancelled')
}
