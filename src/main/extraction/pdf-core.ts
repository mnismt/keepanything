import { readFile } from 'node:fs/promises'
import { EXTRACTION_BUDGET } from './types'

/**
 * PDF text extraction shared by the worker task (`extract.pdf`) and the in-process fallback.
 * `unpdf` (serverless pdf.js build) is loaded lazily so bundles that never touch a PDF stay quick.
 */

/** What `extractPdf` returns (structured-cloneable). */
export interface PdfExtraction {
  pageCount: number
  /** Pages joined with blank lines, capped at `maxChars`. */
  text: string
  /** Text of page 1 (≤ 4 000 chars). */
  firstPageText: string
  pagesRead: number
  truncated: boolean
  /** Page-1 media box in points. */
  pageSize: { width: number; height: number } | null
  info: PdfInfo
}

export interface PdfInfo {
  title?: string
  author?: string
  subject?: string
  keywords?: string
  creator?: string
  producer?: string
  createdAt?: string
  modifiedAt?: string
}

export interface PdfOptions {
  maxPages?: number
  maxChars?: number
  signal?: AbortSignal
}

interface TextItem {
  str?: string
  hasEOL?: boolean
}

type Unpdf = typeof import('unpdf')

let unpdfModule: Promise<Unpdf> | null = null
function loadUnpdf(): Promise<Unpdf> {
  if (!unpdfModule) unpdfModule = import('unpdf')
  return unpdfModule
}

/** `D:20230313000911Z` / `D:20230313000911+01'00'` -> ISO-8601. */
export function pdfDateToIso(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const m = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(Z|[+-]\d{2}'?\d{2}'?)?/.exec(value.trim())
  if (!m) return undefined
  const [, y, mo = '01', d = '01', h = '00', mi = '00', s = '00', tz] = m
  const offset = !tz || tz === 'Z' ? 'Z' : `${tz.slice(0, 3)}:${tz.slice(3).replace(/'/g, '').padEnd(2, '0')}`
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}${offset}`
  return Number.isNaN(Date.parse(iso)) ? undefined : new Date(iso).toISOString()
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const s = value.replace(/\s+/g, ' ').trim()
  return s.length > 0 ? s : undefined
}

/** Join pdf.js text items into lines; `hasEOL` marks line breaks, x-gaps become spaces. */
export function joinTextItems(items: readonly TextItem[]): string {
  let out = ''
  for (const item of items) {
    const str = item.str ?? ''
    if (str.length > 0) {
      const needsSpace = out.length > 0 && !out.endsWith('\n') && !out.endsWith(' ') && !str.startsWith(' ')
      out += (needsSpace ? ' ' : '') + str
    }
    if (item.hasEOL) out += '\n'
  }
  return out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/-\n(?=[a-z])/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function extractPdf(bytes: Uint8Array, opts: PdfOptions = {}): Promise<PdfExtraction> {
  const maxPages = opts.maxPages ?? EXTRACTION_BUDGET.pdfMaxPages
  const maxChars = opts.maxChars ?? EXTRACTION_BUDGET.maxChars
  const { getDocumentProxy } = await loadUnpdf()
  const doc = await getDocumentProxy(bytes, { isEvalSupported: false } as never)
  try {
    const pageCount = doc.numPages
    const pages: string[] = []
    let chars = 0
    let pagesRead = 0
    let firstPageText = ''
    let pageSize: PdfExtraction['pageSize'] = null
    let truncated = false
    for (let n = 1; n <= Math.min(pageCount, maxPages); n += 1) {
      if (opts.signal?.aborted) throw new Error('PDF extraction cancelled')
      const page = await doc.getPage(n)
      if (n === 1) {
        const viewport = page.getViewport({ scale: 1 })
        pageSize = { width: Math.round(viewport.width), height: Math.round(viewport.height) }
      }
      const content = await page.getTextContent()
      const text = joinTextItems(content.items as TextItem[])
      pagesRead = n
      if (n === 1) firstPageText = text.slice(0, 4000)
      if (chars + text.length > maxChars) {
        pages.push(text.slice(0, Math.max(0, maxChars - chars)))
        truncated = true
        break
      }
      pages.push(text)
      chars += text.length + 2
    }
    if (pagesRead < pageCount) truncated = true
    const metaResult = await doc.getMetadata().catch(() => null)
    const raw = (metaResult?.info ?? {}) as Record<string, unknown>
    const info: PdfInfo = {}
    const title = cleanString(raw.Title)
    const author = cleanString(raw.Author)
    const subject = cleanString(raw.Subject)
    const keywords = cleanString(raw.Keywords)
    const creator = cleanString(raw.Creator)
    const producer = cleanString(raw.Producer)
    const createdAt = pdfDateToIso(raw.CreationDate)
    const modifiedAt = pdfDateToIso(raw.ModDate)
    if (title) info.title = title
    if (author) info.author = author
    if (subject) info.subject = subject
    if (keywords) info.keywords = keywords
    if (creator) info.creator = creator
    if (producer) info.producer = producer
    if (createdAt) info.createdAt = createdAt
    if (modifiedAt) info.modifiedAt = modifiedAt
    return {
      pageCount,
      text: pages.join('\n\n').trim(),
      firstPageText,
      pagesRead,
      truncated,
      pageSize,
      info
    }
  } finally {
    await (doc as unknown as { destroy?: () => Promise<void> }).destroy?.()?.catch(() => undefined)
  }
}

export async function extractPdfFile(path: string, opts: PdfOptions = {}): Promise<PdfExtraction> {
  const bytes = new Uint8Array(await readFile(path))
  return extractPdf(bytes, opts)
}
