import { readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname } from 'node:path'
import mime from 'mime'
import { LIMITS } from '../../shared/constants'
import type { CaptureDropRequest } from '../../shared/ipc'
import type { CaptureMode, CaptureResult, CaptureResultItem, Item, ItemType, Settings } from '../../shared/types'
import type { CollectionService } from '../core/collection-service'
import { KaError } from '../core/errors'
import { type IdGenerator, uuid } from '../core/ids'
import type { ItemPipeline, ItemService, NewItemInput } from '../core/item-service'
import { readHeader } from '../extraction/image'
import { deriveTitle, extractTextContent } from '../extraction/text'
import { detectUrlKind } from '../extraction/url/detect'
import { sha256Bytes, sha256File } from '../lib/fs'
import type { BlobPayload, CaptureOptions, Clock, Intake, Logger, WorkerClient } from '../ports'
import type { Db } from '../storage/db'
import type { ObjectStore } from '../storage/object-store'
import { classifyBytes, classifyFile, isScreenshotName, isTempPath } from './classify'
import { folderMetadataFrom, scanFolder } from './folder'
import { canonicalizeUrl, guessUrlSubtype, isMediaUrl, isSingleUrl, parseUriList, titleFromUrl } from './url'

/**
 * Intake: the only place drops are classified. Files (mime by extension
 * + magic sniff, sha256, copy-or-reference; screenshots and temp paths always copied), folders (one
 * item with a shallow manifest), URLs (canonicalized, subtype from the URL table), text (notes with
 * a derived title), blobs (pasted images). Dedupe by sha256 / canonical URL. Every write goes through
 * `ItemService` / `ObjectStore`; jobs come from `graph.initialStages`.
 */

export interface IntakeDeps {
  db: Db
  items: ItemService
  collections: CollectionService
  pipeline: ItemPipeline
  objectStore: ObjectStore
  settings: () => Settings
  clock: Clock
  logger: Logger
  ids?: IdGenerator
  /** Override for tests (default `os.tmpdir()`). */
  tmpDir?: string
  /** Hash big files off the main thread (`extract.hash`); optional. */
  worker?: WorkerClient
}

/** Files above this size are hashed in the worker when one is available. */
const WORKER_HASH_BYTES = 8 * 1024 * 1024

export { classifyFile, isTempPath } from './classify'
export { canonicalizeUrl, guessUrlSubtype, isMediaUrl, parseUriList } from './url'

function excerptOf(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, LIMITS.excerptChars)
}

function titleFromFilename(name: string): string {
  const base = basename(name)
  const ext = extname(base)
  const stem = ext.length > 0 && ext.length <= 6 ? base.slice(0, -ext.length) : base
  return stem.trim() || base
}

/** Provisional title from dragged HTML: link text or `<title>`. */
export function htmlTitle(html: string | undefined): string | null {
  if (!html) return null
  const title = /<title[^>]*>([^<]{1,200})<\/title>/i.exec(html)?.[1] ?? /<a[^>]*>([^<]{1,200})<\/a>/i.exec(html)?.[1]
  return title ? title.replace(/\s+/g, ' ').trim() || null : null
}

/** True when the text reads as Markdown (headings, lists, links, fences). */
export function looksLikeMarkdown(text: string): boolean {
  return /^#{1,6}\s|\n\s*[-*]\s|\[[^\]]+\]\([^)]+\)|```/.test(text)
}

export function createIntake(deps: IntakeDeps): Intake {
  const { db, items, collections, pipeline, objectStore, settings, clock, logger } = deps
  const ids = deps.ids ?? uuid
  const tmpDir = deps.tmpDir ?? tmpdir()

  const finish = (created: CaptureResultItem[], batchId: string, opts: CaptureOptions | undefined): CaptureResult => {
    if (opts?.collectionId && created.length > 0) {
      const collectionId = opts.collectionId
      collections.addItems(
        collectionId,
        created.filter((c) => c.status === 'created').map((c) => ({ itemId: c.id })),
        { actor: 'user' }
      )
    }
    return { items: created, batchId }
  }

  /** Item + initial jobs in one transaction. */
  const createWithJobs = (input: NewItemInput): Item =>
    db.transaction(() => {
      const item = items.create(input)
      pipeline.enqueueInitial(item)
      return item
    })

  const duplicate = (existing: Item): CaptureResultItem => {
    items.keptAgain(existing.id)
    return { id: existing.id, status: 'duplicate', existingId: existing.id, title: existing.title }
  }

  const findByHash = (hash: string): Item | null => {
    const found = db
      .prepare('SELECT id FROM items WHERE content_hash = ? AND deleted_at IS NULL ORDER BY captured_at LIMIT 1')
      .get(hash) as { id: string } | undefined
    return found ? items.find(found.id) : null
  }

  const findByCanonical = (canonical: string): Item | null => {
    const found = db
      .prepare('SELECT id FROM items WHERE canonical_url = ? AND deleted_at IS NULL ORDER BY captured_at LIMIT 1')
      .get(canonical) as { id: string } | undefined
    return found ? items.find(found.id) : null
  }

  const hashFile = async (path: string, size: number): Promise<string> => {
    if (deps.worker && size > WORKER_HASH_BYTES) {
      try {
        const result = await deps.worker.call<{ sha256: string }>('extract.hash', { path }, { timeoutMs: 120_000 })
        return result.sha256
      } catch (error) {
        logger.debug('worker hash failed; hashing in main', { error })
      }
    }
    return sha256File(path)
  }

  const captureFolder = async (
    path: string,
    batchId: string,
    opts: CaptureOptions | undefined
  ): Promise<CaptureResultItem> => {
    const name = basename(path)
    const scan = await scanFolder(path, { maxTopLevel: 60 })
    const folder = folderMetadataFrom(scan)
    const item = createWithJobs({
      type: 'folder',
      title: name,
      originalPath: path,
      size: scan.totalBytes,
      captureBatchId: batchId,
      excerpt: excerptOf(
        `${scan.fileCount} files · ${scan.topLevel
          .slice(0, 8)
          .map((e) => e.name)
          .join(', ')}`
      ),
      metadata: {
        originalName: name,
        source: opts?.source ?? 'api',
        folder,
        topLevel: scan.topLevel
      }
    })
    return { id: item.id, status: 'created', title: item.title }
  }

  const captureOneFile = async (
    path: string,
    mode: CaptureMode,
    batchId: string,
    opts: CaptureOptions | undefined,
    extraMeta: Record<string, unknown> = {}
  ): Promise<CaptureResultItem> => {
    const stats = await stat(path)
    const name = basename(path)
    if (stats.isDirectory()) return captureFolder(path, batchId, opts)
    if (!stats.isFile()) throw new KaError('VALIDATION', "That isn't a file we can keep.")

    let mimeType = mime.getType(name)
    let { type, subtype } = classifyFile(name, mimeType)
    // Magic sniff: extensionless or mislabeled images/PDFs.
    if (type === 'unknown' || type === 'file' || (type === 'image' && !mimeType)) {
      const header = await readHeader(path, 16 * 1024).catch(() => null)
      const sniffed = header ? classifyBytes(header) : null
      if (sniffed) {
        type = sniffed.type
        mimeType = mimeType ?? sniffed.mimeType
        if (type === 'image') subtype = isScreenshotName(name) ? 'screenshot' : null
        else subtype = null
      }
    }
    const hash = await hashFile(path, stats.size)
    const existing = findByHash(hash)
    if (existing) return duplicate(existing)

    const id = ids()
    const screenshot = type === 'image' && (subtype === 'screenshot' || isScreenshotName(name))
    const copy = mode === 'copy' || isTempPath(path, tmpDir) || screenshot
    let managedPath: string | null = null
    if (copy) managedPath = (await objectStore.copyFile(id, path, name)).managedPath
    const input: NewItemInput = {
      id,
      type,
      subtype,
      title: titleFromFilename(name),
      originalPath: path,
      managedPath,
      mimeType,
      size: stats.size,
      contentHash: hash,
      captureBatchId: batchId,
      metadata: {
        originalName: name,
        extension: extname(name).slice(1).toLowerCase() || undefined,
        source: opts?.source ?? 'api',
        fileModifiedAt: stats.mtime.toISOString(),
        ...extraMeta
      }
    }
    if ((type === 'text' || type === 'markdown') && stats.size <= 2_000_000) {
      const text = await readFile(path, 'utf8')
      const content = extractTextContent(text, { fileName: name, kind: type === 'markdown' ? 'markdown' : 'text' })
      input.extractedText = content.text
      input.excerpt = excerptOf(content.text)
      if (content.meta.headings) input.metadata = { ...input.metadata, headings: content.meta.headings as string[] }
    }
    const item = createWithJobs(input)
    return { id: item.id, status: 'created', title: item.title }
  }

  const captureUrlInternal = (
    raw: string,
    batchId: string,
    opts: CaptureOptions | undefined,
    provisionalTitle?: string | null
  ): CaptureResultItem => {
    const parsed = canonicalizeUrl(raw)
    if (!parsed) throw new KaError('VALIDATION', "That doesn't look like a web address.")
    const existing = findByCanonical(parsed.canonical)
    if (existing) return duplicate(existing)
    const url = new URL(parsed.url)
    const detected = detectUrlKind(parsed.url)
    const metadata: NewItemInput['metadata'] = { source: opts?.source ?? 'api', urlKind: detected.kind }
    if (detected.owner && detected.repo) metadata.repo = { owner: detected.owner, name: detected.repo }
    const item = createWithJobs({
      type: 'url',
      subtype: guessUrlSubtype(parsed.domain, url.pathname),
      title:
        provisionalTitle?.trim() ||
        (detected.kind === 'github_repo' ? `${detected.owner}/${detected.repo}` : titleFromUrl(url)),
      url: parsed.url,
      canonicalUrl: parsed.canonical,
      domain: parsed.domain,
      captureBatchId: batchId,
      metadata
    })
    return { id: item.id, status: 'created', title: item.title }
  }

  const captureTextInternal = async (
    text: string,
    title: string | undefined,
    batchId: string,
    opts: CaptureOptions | undefined
  ): Promise<CaptureResultItem> => {
    const trimmed = text.replace(/\r\n?/g, '\n').trim()
    if (trimmed.length === 0) throw new KaError('VALIDATION', 'Nothing to keep there.')
    const hash = sha256Bytes(trimmed)
    const existing = findByHash(hash)
    if (existing) return duplicate(existing)
    const id = ids()
    const markdown = looksLikeMarkdown(trimmed)
    const type: ItemType = markdown ? 'markdown' : 'text'
    const stored = await objectStore.writeBytes(
      id,
      markdown ? 'text.md' : 'text.txt',
      new TextEncoder().encode(trimmed)
    )
    const content = extractTextContent(trimmed, { kind: markdown ? 'markdown' : 'text' })
    const derived = deriveTitle(trimmed)
    const metadata: NewItemInput['metadata'] = { source: opts?.source ?? 'api', wordCount: content.meta.wordCount }
    if (content.meta.headings) metadata.headings = content.meta.headings as string[]
    const item = createWithJobs({
      id,
      type,
      title: title?.trim() || derived || 'Text',
      managedPath: stored.managedPath,
      mimeType: markdown ? 'text/markdown' : 'text/plain',
      size: stored.size,
      contentHash: hash,
      extractedText: content.text,
      excerpt: excerptOf(content.text),
      captureBatchId: batchId,
      metadata
    })
    return { id: item.id, status: 'created', title: item.title }
  }

  const captureBlobInternal = async (
    payload: BlobPayload,
    batchId: string,
    opts: CaptureOptions | undefined
  ): Promise<CaptureResultItem> => {
    const bytes = payload.bytes instanceof Uint8Array ? payload.bytes : new Uint8Array(payload.bytes)
    if (bytes.byteLength === 0) throw new KaError('VALIDATION', 'Nothing to keep there.')
    const hash = sha256Bytes(bytes)
    const existing = findByHash(hash)
    if (existing) return duplicate(existing)
    const sniffed = classifyBytes(bytes.subarray(0, 16 * 1024))
    let mimeType = payload.mimeType || sniffed?.mimeType || null
    if (sniffed && payload.mimeType.startsWith('image/') && sniffed.mimeType !== payload.mimeType)
      mimeType = sniffed.mimeType
    const ext = mimeType ? mime.getExtension(mimeType) : null
    const given = payload.name.trim()
    const stamp = clock.now().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const isImage = mimeType?.startsWith('image/') ?? false
    const name =
      given.length > 0
        ? extname(given).length > 0 || !ext
          ? given
          : `${given}.${ext}`
        : `${isImage ? 'pasted' : 'clip'}-${clock.now().getTime()}${ext ? `.${ext}` : ''}`
    const id = ids()
    const stored = await objectStore.writeBytes(id, name, bytes)
    const { type, subtype } = classifyFile(name, mimeType)
    const input: NewItemInput = {
      id,
      type: sniffed?.type ?? type,
      subtype: sniffed?.type === 'image' ? subtype : subtype,
      title:
        given.length > 0
          ? titleFromFilename(given)
          : isImage
            ? `Pasted image ${stamp.slice(0, 10)}`
            : titleFromFilename(name),
      managedPath: stored.managedPath,
      mimeType,
      size: stored.size,
      contentHash: hash,
      captureBatchId: batchId,
      metadata: { originalName: name, source: opts?.source ?? 'paste', pasted: given.length === 0 }
    }
    if ((input.type === 'text' || input.type === 'markdown') && bytes.byteLength <= 2_000_000) {
      const text = new TextDecoder().decode(bytes)
      const content = extractTextContent(text, { kind: input.type === 'markdown' ? 'markdown' : 'text' })
      input.extractedText = content.text
      input.excerpt = excerptOf(content.text)
    }
    const item = createWithJobs(input)
    return { id: item.id, status: 'created', title: item.title }
  }

  const intake: Intake = {
    async captureFiles(paths, mode, opts) {
      const batchId = opts?.batchId ?? ids()
      const effectiveMode = mode ?? settings().importMode
      const results: CaptureResultItem[] = []
      for (const path of paths) {
        try {
          results.push(await captureOneFile(path, effectiveMode, batchId, opts))
        } catch (error) {
          logger.warn('could not capture file', { path, error })
        }
      }
      if (results.length === 0 && paths.length > 0) throw new KaError('NOT_FOUND', "Couldn't read those files.")
      return finish(results, batchId, opts)
    },
    async captureUrl(url, opts) {
      const batchId = opts?.batchId ?? ids()
      return finish([captureUrlInternal(url, batchId, opts)], batchId, opts)
    },
    async captureText(text, title, opts) {
      const batchId = opts?.batchId ?? ids()
      if (!title && isSingleUrl(text)) return finish([captureUrlInternal(text.trim(), batchId, opts)], batchId, opts)
      return finish([await captureTextInternal(text, title, batchId, opts)], batchId, opts)
    },
    async captureBlob(payload, opts) {
      const batchId = opts?.batchId ?? ids()
      return finish([await captureBlobInternal(payload, batchId, opts)], batchId, opts)
    },
    async captureDrop(payload: CaptureDropRequest) {
      const batchId = ids()
      const opts: CaptureOptions = {
        source: payload.source,
        batchId,
        ...(payload.collectionId ? { collectionId: payload.collectionId } : {})
      }
      let files = payload.files.filter((f) => f.length > 0)
      let urls = payload.uriList ? parseUriList(payload.uriList) : []
      const text = payload.text?.trim() ?? ''
      const results: CaptureResultItem[] = []
      const provisionalTitle = htmlTitle(payload.html)

      // (1) Link drags from browsers arrive as `.webloc`/`.url` files plus the URL: keep the URL.
      if (urls.length > 0 && files.length > 0 && files.every((f) => /\.(webloc|url)$/i.test(f))) files = []
      // (2) Image drags arrive as a temp file plus the image URL: keep the file, remember the source.
      let sourceUrl: string | null = null
      if (files.length > 0 && urls.length > 0 && urls.every(isMediaUrl)) {
        sourceUrl = urls[0] ?? null
        urls = []
      }
      // (4) A plain-text drop that is exactly one URL is a link, not a note.
      if (urls.length === 0 && isSingleUrl(text)) urls = [text]

      // (3) Temp paths are always copied: `captureOneFile` checks `isTempPath` per file.
      for (const path of files) {
        try {
          results.push(await captureOneFile(path, settings().importMode, batchId, opts, sourceUrl ? { sourceUrl } : {}))
        } catch (error) {
          logger.warn('could not capture dropped file', { path, error })
        }
      }
      const seen = new Set<string>()
      for (const url of urls) {
        const canonical = canonicalizeUrl(url)?.canonical
        if (!canonical || seen.has(canonical)) continue
        seen.add(canonical)
        try {
          results.push(captureUrlInternal(url, batchId, opts, urls.length === 1 ? provisionalTitle : null))
        } catch (error) {
          logger.warn('could not capture dropped url', { url, error })
        }
      }
      const textIsUrl = urls.length === 1 && urls[0] === text
      if (files.length === 0 && urls.length === 0 && text.length > 0 && !textIsUrl) {
        results.push(await captureTextInternal(text, provisionalTitle ?? undefined, batchId, opts))
      }
      if (results.length === 0) throw new KaError('VALIDATION', 'Nothing here we know how to keep yet.')
      return finish(results, batchId, opts)
    }
  }
  return intake
}
