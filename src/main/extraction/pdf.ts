import { basename } from 'node:path'
import { LIMITS } from '../../shared/constants'
import { isKaError } from '../core/errors'
import type { WorkerClient } from '../ports'
import { extractPdfFile, type PdfExtraction, type PdfOptions } from './pdf-core'
import { EXTRACTION_BUDGET, type ExtractedContent, type Extractor, squash } from './types'

/**
 * PDF adapter. Runs `extract.pdf` in the utility-process worker when a client is available
 * (pdf.js is CPU-heavy), otherwise in-process. Produces page count, capped text, page-1 text and
 * size, and the document info dictionary.
 */

/** Worker-call timeout for one PDF (ms). */
const PDF_WORKER_TIMEOUT_MS = 50_000

export async function runPdfExtraction(
  path: string,
  worker: WorkerClient | undefined,
  opts: PdfOptions
): Promise<PdfExtraction> {
  if (worker) {
    try {
      return await worker.call<PdfExtraction>(
        'extract.pdf',
        { path, maxPages: opts.maxPages, maxChars: opts.maxChars },
        { timeoutMs: PDF_WORKER_TIMEOUT_MS, ...(opts.signal ? { signal: opts.signal } : {}) }
      )
    } catch (error) {
      // Only an unregistered task falls back in-process; a worker crash must not freeze main.
      if (!(isKaError(error) && error.code === 'NOT_IMPLEMENTED')) throw error
    }
  }
  return extractPdfFile(path, opts)
}

/** True when a PDF title looks like real metadata rather than a file name or tool default. */
export function plausiblePdfTitle(title: string | undefined, fileName: string): title is string {
  if (!title) return false
  const t = title.trim()
  if (t.length < 4 || t.length > 200) return false
  if (/\.(pdf|docx?|tex|dvi|ps)$/i.test(t)) return false
  if (/^(untitled|microsoft word|document|paper|main|arxiv|draft|slides?|final)(\W|$)/i.test(t)) return false
  const stem = basename(fileName)
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
  if (t.toLowerCase() === stem) return false
  if (!/[a-z]/i.test(t)) return false
  return true
}

export function pdfToContent(result: PdfExtraction, fileName: string): ExtractedContent {
  const meta: Record<string, unknown> = {
    pdf: {
      info: result.info,
      pageSize: result.pageSize,
      pagesRead: result.pagesRead,
      firstPage: result.firstPageText.slice(0, 2000)
    }
  }
  if (result.info.author) meta.byline = result.info.author
  if (result.info.subject) meta.description = squash(result.info.subject, 500)
  const out: ExtractedContent = {
    text: result.text.slice(0, EXTRACTION_BUDGET.maxChars),
    meta,
    truncated: result.truncated || result.text.length > EXTRACTION_BUDGET.maxChars,
    pageCount: result.pageCount
  }
  if (result.pageSize) out.dims = result.pageSize
  if (plausiblePdfTitle(result.info.title, fileName)) out.title = result.info.title
  else {
    // First non-trivial line of page 1 often is the title (papers, reports).
    const line = result.firstPageText
      .split('\n')
      .map((l) => l.trim())
      .find(
        (l) => l.length >= 12 && l.length <= 160 && /[a-z]/i.test(l) && !/^(published|arxiv|preprint|vol\.)/i.test(l)
      )
    if (line) meta.firstLine = line
  }
  const excerpt = squash(result.text, LIMITS.excerptChars)
  if (excerpt) meta.excerpt = excerpt
  if (result.text.length === 0) {
    out.partial = true
    out.error = 'No text layer (scanned PDF?)'
  }
  return out
}

export const pdfExtractor: Extractor = {
  id: 'pdf',
  async extract({ item, filePath }, deps) {
    if (!filePath) throw new Error('No PDF file to read')
    const result = await runPdfExtraction(filePath, deps.worker, {
      maxPages: EXTRACTION_BUDGET.pdfMaxPages,
      maxChars: EXTRACTION_BUDGET.maxChars,
      ...(deps.signal ? { signal: deps.signal } : {})
    })
    return pdfToContent(result, item.metadata.originalName ?? basename(filePath))
  }
}
