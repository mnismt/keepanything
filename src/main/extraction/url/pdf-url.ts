import { basename } from 'node:path'
import type { Item } from '../../../shared/types'
import { pdfToContent, runPdfExtraction } from '../pdf'
import { extractPdf } from '../pdf-core'
import { EXTRACTION_BUDGET, type ExtractedContent, type ExtractionDeps } from '../types'

/**
 * A URL that turned out to be a PDF (by header or extension): keep the bytes in `objects/`
 * (the link may die), extract the text, and ask for a `thumbnail` so the card shows page 1.
 */
export async function keepPdfFromUrl(
  bytes: Uint8Array,
  item: Item,
  finalUrl: string,
  deps: ExtractionDeps
): Promise<ExtractedContent> {
  const name = pdfFileName(finalUrl, item.title)
  const opts = {
    maxPages: EXTRACTION_BUDGET.pdfMaxPages,
    maxChars: EXTRACTION_BUDGET.maxChars,
    ...(deps.signal ? { signal: deps.signal } : {})
  }
  if (!deps.objectStore) {
    const content = pdfToContent(await extractPdf(bytes, opts), name)
    content.meta.urlKind = 'pdf'
    content.item = { ...content.item, mimeType: 'application/pdf', subtype: 'paper' }
    return content
  }
  const stored = await deps.objectStore.writeBytes(item.id, name, bytes)
  const result = deps.objectStore.resolve
    ? await runPdfExtraction(deps.objectStore.resolve(stored.managedPath), deps.worker, opts)
    : await extractPdf(bytes, opts)
  const content = pdfToContent(result, name)
  content.meta.urlKind = 'pdf'
  content.meta.downloadedFrom = finalUrl
  content.item = {
    ...content.item,
    managedPath: stored.managedPath,
    mimeType: 'application/pdf',
    size: stored.size,
    contentHash: stored.sha256,
    subtype: 'paper'
  }
  content.followUp = ['thumbnail']
  return content
}

/** A safe `.pdf` file name from the URL path (falls back to the item title). */
export function pdfFileName(url: string, fallbackTitle: string): string {
  let stem = ''
  try {
    stem = decodeURIComponent(basename(new URL(url).pathname)).replace(/\.pdf$/i, '')
  } catch {
    stem = ''
  }
  if (stem.length < 2) stem = fallbackTitle.replace(/\s+·\s+.*$/, '')
  stem =
    stem
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/[\s-]+/g, ' ')
      .trim() || 'document'
  return `${stem.slice(0, 120)}.pdf`
}
