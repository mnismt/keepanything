import { LIMITS } from '../../../../shared/constants'
import type { Item } from '../../../../shared/types'
import { capText, EXTRACTION_BUDGET, type ExtractedContent, type ExtractionDeps, squash } from '../../types'
import type { DetectedUrl } from '../detect'
import { fetchPage, isPdfType } from '../fetch'
import { type LinkedomDocument, loadLinkedom } from '../metadata'
import { keepPdfFromUrl } from '../pdf-url'
import { extractGeneric } from './generic'

/**
 * arXiv: the abs page carries Highwire `citation_*` meta tags (title, authors, date, pdf url) and
 * the abstract. Links straight to the PDF also keep the PDF bytes when an object store is present.
 */

export interface ArxivFacts {
  id: string
  title?: string
  authors: string[]
  abstract?: string
  published?: string
  pdfUrl?: string
  subjects?: string
  doi?: string
}

export async function parseArxivAbs(html: string, id: string): Promise<ArxivFacts> {
  const { parseHTML } = await loadLinkedom()
  const { document } = parseHTML(html) as unknown as { document: LinkedomDocument }
  const meta = (name: string): string | undefined =>
    document.querySelector(`meta[name="${name}"]`)?.getAttribute('content')?.replace(/\s+/g, ' ').trim() || undefined
  const authors: string[] = []
  for (const el of document.querySelectorAll('meta[name="citation_author"]')) {
    const value = el.getAttribute('content')?.trim()
    if (value) authors.push(value)
  }
  const facts: ArxivFacts = { id, authors }
  const title =
    meta('citation_title') ??
    document
      .querySelector('h1.title')
      ?.textContent?.replace(/^Title:\s*/i, '')
      .trim()
  if (title) facts.title = squash(title, 300)
  const abstract =
    meta('citation_abstract') ??
    document
      .querySelector('blockquote.abstract')
      ?.textContent?.replace(/^\s*Abstract:\s*/i, '')
      .trim() ??
    meta('description')
  if (abstract) facts.abstract = abstract.replace(/\s+/g, ' ').trim()
  const date = meta('citation_date') ?? meta('citation_online_date')
  if (date) {
    const ms = Date.parse(date.replace(/\//g, '-'))
    if (!Number.isNaN(ms)) facts.published = new Date(ms).toISOString()
  }
  const pdf = meta('citation_pdf_url')
  if (pdf) facts.pdfUrl = pdf
  const subjects = document.querySelector('td.tablecell.subjects')?.textContent?.replace(/\s+/g, ' ').trim()
  if (subjects) facts.subjects = subjects
  const doi = meta('citation_doi')
  if (doi) facts.doi = doi
  return facts
}

export async function extractArxiv(item: Item, deps: ExtractionDeps, detected: DetectedUrl): Promise<ExtractedContent> {
  const id = detected.arxivId
  const absUrl = detected.absUrl
  if (!id || !absUrl) return extractGeneric(item, deps, detected)
  const fetchOpts = {
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    ...(deps.signal ? { signal: deps.signal } : {})
  }
  const page = await fetchPage(absUrl, { ...fetchOpts, wantBytes: false })
  if (page === null) throw new Error('Could not reach arxiv.org')
  if (!page.html || page.status >= 400) return extractGeneric(item, deps, detected)
  const facts = await parseArxivAbs(page.html, id)
  const lines = [
    facts.title ?? '',
    facts.authors.length > 0 ? `Authors: ${facts.authors.join(', ')}` : '',
    facts.subjects ? `Subjects: ${facts.subjects}` : '',
    facts.abstract ? `\n${facts.abstract}` : ''
  ].filter((l) => l.length > 0)
  const text = capText(lines.join('\n'), EXTRACTION_BUDGET.maxChars)
  const meta: Record<string, unknown> = {
    arxiv: facts,
    urlKind: 'arxiv',
    siteName: 'arXiv',
    favicon: 'https://arxiv.org/favicon.ico',
    og: { title: facts.title, description: facts.abstract, canonical: absUrl, siteName: 'arXiv' },
    byline: facts.authors.slice(0, 6).join(', ') || undefined
  }
  if (facts.abstract) {
    meta.description = squash(facts.abstract, 1000)
    meta.excerpt = squash(facts.abstract, LIMITS.excerptChars)
  }
  if (facts.published) meta.publishedAt = facts.published
  const out: ExtractedContent = {
    text: text.text,
    meta,
    truncated: text.truncated,
    item: { subtype: 'paper' }
  }
  if (facts.title) out.title = facts.title
  if (facts.abstract)
    out.markdown = `# ${facts.title ?? id}\n\n${facts.authors.join(', ')}\n\n## Abstract\n\n${facts.abstract}`

  // A direct PDF link: keep the bytes too, so the paper survives offline and gets a page-1 thumbnail.
  if (/\/pdf\//.test(detected.path) && deps.objectStore) {
    const pdf = await fetchPage(item.url ?? absUrl, fetchOpts).catch(() => null)
    if (pdf?.bytes && isPdfType(pdf.contentType)) {
      const kept = await keepPdfFromUrl(pdf.bytes, item, pdf.finalUrl, deps)
      const merged: ExtractedContent = {
        ...kept,
        text: kept.text.length > text.text.length ? kept.text : text.text,
        meta: { ...kept.meta, ...meta, pdf: kept.meta.pdf, urlKind: 'arxiv' },
        item: { ...kept.item, subtype: 'paper' }
      }
      if (facts.title) merged.title = facts.title
      if (out.markdown) merged.markdown = out.markdown
      return merged
    }
  }
  return out
}
