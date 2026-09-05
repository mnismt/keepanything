import { createReadStream } from 'node:fs'
import { open } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { createGunzip, inflateRawSync } from 'node:zlib'
import { LIMITS } from '../../shared/constants'
import { EXTRACTION_BUDGET, type ExtractedContent, type Extractor, squash } from './types'

/**
 * Archives: entry listings for zip (central directory), tar and tar.gz (headers) with
 * `node:zlib` only; other formats get metadata only. Also reads single zip entries so Office
 * documents (docx/pptx/odt: zip + XML) yield text without extra dependencies.
 */

export interface ArchiveEntry {
  name: string
  size: number
  /** Zip only: compression method (0 stored, 8 deflate) and local header offset. */
  method?: number
  offset?: number
}

export interface ArchiveListing {
  format: 'zip' | 'tar' | 'tgz' | 'other'
  entries: ArchiveEntry[]
  entryCount: number
  truncated: boolean
  uncompressedBytes: number
}

const MAX_ENTRIES = 500
const ZIP_EOCD = 0x06054b50
const ZIP_CENTRAL = 0x02014b50
const ZIP_LOCAL = 0x04034b50

async function readAt(path: string, position: number, length: number): Promise<Uint8Array> {
  const handle = await open(path, 'r')
  try {
    const buffer = new Uint8Array(length)
    let read = 0
    while (read < length) {
      const r = await handle.read(buffer, read, length - read, position + read)
      if (r.bytesRead === 0) break
      read += r.bytesRead
    }
    return buffer.subarray(0, read)
  } finally {
    await handle.close()
  }
}

/** List a zip's central directory. Zip64 is treated as unsupported (metadata only). */
export async function listZip(path: string): Promise<ArchiveListing> {
  const handle = await open(path, 'r')
  const size = (await handle.stat()).size
  await handle.close()
  const tailLength = Math.min(size, 66_000)
  const tail = await readAt(path, size - tailLength, tailLength)
  const tv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength)
  let eocd = -1
  for (let i = tail.length - 22; i >= 0; i -= 1) {
    if (tv.getUint32(i, true) === ZIP_EOCD) {
      eocd = i
      break
    }
  }
  const empty: ArchiveListing = { format: 'zip', entries: [], entryCount: 0, truncated: false, uncompressedBytes: 0 }
  if (eocd < 0) return { ...empty, truncated: true }
  const total = tv.getUint16(eocd + 10, true)
  const cdSize = tv.getUint32(eocd + 12, true)
  const cdOffset = tv.getUint32(eocd + 16, true)
  if (cdOffset === 0xffffffff || total === 0xffff) return { ...empty, entryCount: total, truncated: true }
  const cd = await readAt(path, cdOffset, Math.min(cdSize, 8_000_000))
  const view = new DataView(cd.buffer, cd.byteOffset, cd.byteLength)
  const entries: ArchiveEntry[] = []
  let uncompressedBytes = 0
  let pos = 0
  let count = 0
  const decoder = new TextDecoder('utf-8')
  while (pos + 46 <= cd.length && view.getUint32(pos, true) === ZIP_CENTRAL) {
    const method = view.getUint16(pos + 10, true)
    const uncompressed = view.getUint32(pos + 24, true)
    const nameLength = view.getUint16(pos + 28, true)
    const extraLength = view.getUint16(pos + 30, true)
    const commentLength = view.getUint16(pos + 32, true)
    const offset = view.getUint32(pos + 42, true)
    const name = decoder.decode(cd.subarray(pos + 46, pos + 46 + nameLength))
    count += 1
    uncompressedBytes += uncompressed
    if (entries.length < MAX_ENTRIES) entries.push({ name, size: uncompressed, method, offset })
    pos += 46 + nameLength + extraLength + commentLength
  }
  return {
    format: 'zip',
    entries,
    entryCount: Math.max(count, total),
    truncated: count > MAX_ENTRIES || count < total,
    uncompressedBytes
  }
}

/** Read and decompress one zip entry (stored or deflate). Null when absent/unsupported/too big. */
export async function readZipEntry(path: string, name: string, maxBytes = 20_000_000): Promise<Uint8Array | null> {
  const listing = await listZip(path)
  const entry = listing.entries.find((e) => e.name === name)
  if (!entry || entry.offset === undefined || entry.size > maxBytes) return null
  const header = await readAt(path, entry.offset, 30)
  const hv = new DataView(header.buffer, header.byteOffset, header.byteLength)
  if (header.length < 30 || hv.getUint32(0, true) !== ZIP_LOCAL) return null
  const nameLength = hv.getUint16(26, true)
  const extraLength = hv.getUint16(28, true)
  const compressedSize = hv.getUint32(18, true) || entry.size
  const dataStart = entry.offset + 30 + nameLength + extraLength
  const data = await readAt(path, dataStart, Math.min(compressedSize, maxBytes))
  if (entry.method === 0) return data
  if (entry.method === 8) {
    try {
      return new Uint8Array(inflateRawSync(data, { maxOutputLength: maxBytes }))
    } catch {
      return null
    }
  }
  return null
}

/** List a tar (optionally gzip'd) by walking 512-byte headers. */
export function listTar(path: string, gzip: boolean): Promise<ArchiveListing> {
  return new Promise((resolve) => {
    const entries: ArchiveEntry[] = []
    let uncompressedBytes = 0
    let count = 0
    let pending = new Uint8Array(0)
    let skip = 0
    let done = false
    const format = gzip ? 'tgz' : 'tar'
    const finish = (truncated: boolean): void => {
      if (done) return
      done = true
      resolve({ format, entries, entryCount: count, truncated, uncompressedBytes })
    }
    const source = createReadStream(path)
    const stream = gzip ? source.pipe(createGunzip()) : source
    const decoder = new TextDecoder('utf-8')
    stream.on('data', (chunk: Buffer) => {
      if (done) return
      const merged = new Uint8Array(pending.length + chunk.length)
      merged.set(pending)
      merged.set(chunk, pending.length)
      let pos = 0
      while (pos + 512 <= merged.length) {
        if (skip > 0) {
          const step = Math.min(skip, merged.length - pos)
          pos += step
          skip -= step
          if (skip > 0) break
          continue
        }
        const header = merged.subarray(pos, pos + 512)
        if (header.every((b) => b === 0)) {
          finish(false)
          source.destroy()
          return
        }
        const rawName = decoder.decode(header.subarray(0, 100)).replace(/\0.*$/s, '')
        const prefix = decoder.decode(header.subarray(345, 500)).replace(/\0.*$/s, '')
        const sizeField = decoder.decode(header.subarray(124, 136)).replace(/\0.*$/s, '').trim()
        const size = Number.parseInt(sizeField || '0', 8) || 0
        const type = String.fromCharCode(header[156] ?? 48)
        const name = prefix ? `${prefix}/${rawName}` : rawName
        pos += 512
        if (type === '0' || type === '\0' || type === '5') {
          count += 1
          if (type !== '5') uncompressedBytes += size
          if (entries.length < MAX_ENTRIES)
            entries.push({ name: type === '5' ? `${name.replace(/\/$/, '')}/` : name, size })
          if (count >= MAX_ENTRIES * 4) {
            finish(true)
            source.destroy()
            return
          }
        }
        skip = Math.ceil(size / 512) * 512
      }
      pending = merged.subarray(pos)
    })
    stream.on('end', () => finish(false))
    stream.on('error', () => finish(true))
    source.on('error', () => finish(true))
  })
}

export function archiveFormat(name: string): 'zip' | 'tar' | 'tgz' | 'other' {
  const lower = name.toLowerCase()
  if (/\.(tar\.gz|tgz)$/.test(lower)) return 'tgz'
  if (lower.endsWith('.tar')) return 'tar'
  const ext = extname(lower).slice(1)
  if (['zip', 'jar', 'war', 'epub', 'xpi', 'apk', 'ipa', 'crx', 'whl'].includes(ext)) return 'zip'
  return 'other'
}

/** Listing -> normalised content (names as text so FTS finds "that zip with the invoices"). */
export function listingToContent(listing: ArchiveListing, fileName: string): ExtractedContent {
  const names = listing.entries.map((e) => e.name).filter((n) => !/(^|\/)(__MACOSX|\.DS_Store)/.test(n))
  const text = [`Archive: ${fileName}`, `${listing.entryCount} entries`, ...names.slice(0, 300)].join('\n')
  const meta: Record<string, unknown> = {
    archive: {
      format: listing.format,
      entryCount: listing.entryCount,
      truncated: listing.truncated,
      uncompressedBytes: listing.uncompressedBytes,
      entries: names.slice(0, 100)
    },
    excerpt: squash(names.slice(0, 12).join(' · ') || fileName, LIMITS.excerptChars)
  }
  return {
    text: text.slice(0, EXTRACTION_BUDGET.maxChars),
    meta,
    truncated: listing.truncated || names.length > 300,
    partial: listing.entryCount === 0
  }
}

export const archiveExtractor: Extractor = {
  id: 'archive',
  async extract({ item, filePath }) {
    if (!filePath) throw new Error('No archive file to read')
    const name = item.metadata.originalName ?? basename(filePath)
    const format = archiveFormat(name)
    if (format === 'other') {
      return {
        text: '',
        meta: { archive: { format: extname(name).slice(1).toLowerCase() || 'unknown', listed: false } },
        truncated: false,
        partial: true,
        error: 'Archive format not listed'
      }
    }
    const listing = format === 'zip' ? await listZip(filePath) : await listTar(filePath, format === 'tgz')
    return listingToContent(listing, name)
  }
}

const XML_ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/** Strip XML to text, treating paragraph closes as line breaks. */
export function xmlToText(xml: string, paragraphTags: readonly string[]): string {
  let s = xml
  for (const tag of paragraphTags) s = s.replace(new RegExp(`</${tag}>`, 'g'), '\n')
  return s
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<text:tab\/>/g, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => XML_ENTITY[e] ?? '')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Office documents (docx / pptx / odt / odp / ods): text from the zip's XML parts. */
export const officeExtractor: Extractor = {
  id: 'office',
  async extract({ item, filePath }) {
    if (!filePath) throw new Error('No document to read')
    const name = item.metadata.originalName ?? basename(filePath)
    const ext = extname(name).slice(1).toLowerCase()
    const listing = await listZip(filePath).catch(() => null)
    if (!listing || listing.entries.length === 0) {
      return {
        text: '',
        meta: { document: { format: ext, listed: false } },
        truncated: false,
        partial: true,
        error: 'Not a zip container'
      }
    }
    const decoder = new TextDecoder('utf-8')
    const parts: string[] = []
    let title: string | undefined
    if (ext === 'docx') {
      const xml = await readZipEntry(filePath, 'word/document.xml')
      if (xml) parts.push(xmlToText(decoder.decode(xml), ['w:p']))
    } else if (ext === 'pptx') {
      const slides = listing.entries
        .map((e) => e.name)
        .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
        .sort((a, b) => Number(/\d+/.exec(a.slice(11))?.[0] ?? 0) - Number(/\d+/.exec(b.slice(11))?.[0] ?? 0))
      for (const slide of slides.slice(0, 200)) {
        const xml = await readZipEntry(filePath, slide)
        if (xml) parts.push(xmlToText(decoder.decode(xml), ['a:p']))
      }
    } else if (ext === 'odt' || ext === 'odp' || ext === 'ods') {
      const xml = await readZipEntry(filePath, 'content.xml')
      if (xml) parts.push(xmlToText(decoder.decode(xml), ['text:p', 'text:h', 'table:table-row']))
    }
    const core = await readZipEntry(filePath, ext.startsWith('od') ? 'meta.xml' : 'docProps/core.xml')
    if (core) {
      const xml = decoder.decode(core)
      title = /<dc:title>([^<]{2,200})<\/dc:title>/.exec(xml)?.[1]?.trim()
    }
    const text = parts.join('\n\n').trim()
    const meta: Record<string, unknown> = {
      document: { format: ext, parts: parts.length, chars: text.length },
      excerpt: squash(text, LIMITS.excerptChars)
    }
    if (ext === 'pptx') meta.slideCount = parts.length
    const out: ExtractedContent = {
      text: text.slice(0, EXTRACTION_BUDGET.maxChars),
      meta,
      truncated: text.length > EXTRACTION_BUDGET.maxChars
    }
    if (title && !/\.(docx?|pptx?|odt)$/i.test(title)) out.title = squash(title, 200)
    if (text.length === 0) {
      out.partial = true
      out.error = 'No text parts found'
    }
    if (ext === 'pptx') out.pageCount = parts.length
    return out
  }
}
