import { COPY, LIMITS } from '../../../../shared/constants'
import type { Item, UrlSubtype } from '../../../../shared/types'
import { parseImageInfo } from '../../image-dims'
import { capText, EXTRACTION_BUDGET, type ExtractedContent, type ExtractionDeps, squash } from '../../types'
import { runHtmlAnalysis } from '../analyze'
import { readUrlCache, writeUrlCache } from '../cache'
import { bareHost, type DetectedUrl, refineSubtype, subtypeForUrl } from '../detect'
import { type FetchedPage, fetchPage, isImageType, isPdfType } from '../fetch'
import type { PageMetadata } from '../metadata'
import { keepPdfFromUrl } from '../pdf-url'
import type { HtmlAnalysis } from '../readable'

/**
 * Generic web page: fetch (cache first), fall back to the offscreen DOM for JS-rendered pages,
 * metadata + readable Markdown. PDFs and images by content type are handled here too, because a
 * URL only reveals what it is once fetched.
 */

export interface AcquiredPage {
  html: string
  finalUrl: string
  status: number
  via: 'fetch' | 'dom' | 'cache'
}

const canonicalOf = (item: Item): string => item.canonicalUrl ?? item.url ?? ''

/** Fetch HTML for the item, preferring the url-cache; null when nothing usable came back. */
export async function acquireHtml(
  item: Item,
  deps: ExtractionDeps
): Promise<{ page: AcquiredPage | null; raw: FetchedPage | null }> {
  const url = item.url ?? ''
  const canonical = canonicalOf(item)
  const cached = await readUrlCache(deps.urlCacheDir, canonical)
  if (cached && cached.html.length > 0) {
    return { page: { html: cached.html, finalUrl: cached.finalUrl, status: cached.status, via: 'cache' }, raw: null }
  }
  const fetched = await fetchPage(url, {
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    ...(deps.signal ? { signal: deps.signal } : {})
  })
  if (fetched?.html && fetched.status < 400) {
    return {
      page: { html: fetched.html, finalUrl: fetched.finalUrl, status: fetched.status, via: 'fetch' },
      raw: fetched
    }
  }
  return { page: null, raw: fetched }
}

/** Try the offscreen DOM fallback; null when unavailable or it failed. */
export async function acquireDom(item: Item, deps: ExtractionDeps): Promise<AcquiredPage | null> {
  if (!deps.pageFetcher || !item.url) return null
  const dom = await deps.pageFetcher.fetchDom(item.url).catch(() => null)
  if (!dom || dom.html.length < 200) return null
  return { html: dom.html, finalUrl: dom.finalUrl, status: 200, via: 'dom' }
}

/** Persist the page in the url-cache (best effort). */
export async function remember(item: Item, page: AcquiredPage, deps: ExtractionDeps): Promise<void> {
  if (page.via === 'cache') return
  try {
    await writeUrlCache(deps.urlCacheDir, canonicalOf(item), {
      url: item.url ?? '',
      finalUrl: page.finalUrl,
      status: page.status,
      contentType: 'text/html',
      html: page.html,
      fetchedAt: deps.clock.nowIso(),
      via: page.via === 'dom' ? 'dom' : 'fetch'
    })
  } catch (error) {
    deps.logger.debug('url cache write failed', { url: item.url, error })
  }
}

/** Metadata shared by every HTML-derived result. */
export function pageMeta(
  metadata: PageMetadata,
  finalUrl: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  const og: Record<string, unknown> = {}
  if (metadata.title) og.title = metadata.title
  if (metadata.description) og.description = metadata.description
  if (metadata.ogImage) og.image = metadata.ogImage
  if (metadata.siteName) og.siteName = metadata.siteName
  if (metadata.ogType) og.type = metadata.ogType
  if (metadata.canonical) og.canonical = metadata.canonical
  const meta: Record<string, unknown> = { og, finalUrl, ...extra }
  if (metadata.description) meta.description = metadata.description
  if (metadata.siteName) meta.siteName = metadata.siteName
  if (metadata.favicon) meta.favicon = metadata.favicon
  if (metadata.publishedAt) meta.publishedAt = metadata.publishedAt
  if (metadata.byline) meta.byline = metadata.byline
  if (metadata.lang) meta.lang = metadata.lang
  return meta
}

export function contentFromAnalysis(
  _item: Item,
  analysis: HtmlAnalysis,
  page: AcquiredPage,
  provisional: UrlSubtype,
  extraMeta: Record<string, unknown> = {}
): ExtractedContent {
  const { metadata, readable } = analysis
  const readableChars = readable?.length ?? 0
  const subtype = refineSubtype(provisional, {
    ...(metadata.ogType ? { ogType: metadata.ogType } : {}),
    ...(metadata.jsonLdTypes ? { jsonLdTypes: metadata.jsonLdTypes } : {}),
    readableChars
  })
  const meta = pageMeta(metadata, page.finalUrl, {
    fetchedVia: page.via,
    readableChars,
    ...extraMeta
  })
  if (!metadata.siteName) {
    const site = readable?.siteName ?? siteNameFromUrl(page.finalUrl)
    if (site) meta.siteName = site
  }
  if (!metadata.byline && readable?.byline) meta.byline = readable.byline
  if (!metadata.publishedAt && readable?.publishedTime) {
    const ms = Date.parse(readable.publishedTime)
    if (!Number.isNaN(ms)) meta.publishedAt = new Date(ms).toISOString()
  }
  const bodyText = readable?.text ?? ''
  const descriptive = [metadata.title, metadata.description].filter(Boolean).join('\n')
  const capped = capText(bodyText.length > 0 ? bodyText : descriptive, EXTRACTION_BUDGET.maxChars)
  const excerpt = squash(metadata.description ?? readable?.excerpt ?? bodyText, LIMITS.excerptChars)
  if (excerpt) meta.excerpt = excerpt
  const out: ExtractedContent = {
    text: capped.text,
    meta,
    truncated: capped.truncated,
    item: { subtype }
  }
  if (readable?.markdown) out.markdown = readable.markdown
  const title = metadata.title ?? readable?.title
  if (title) out.title = squash(title, 200)
  if (readableChars < EXTRACTION_BUDGET.readableThreshold) {
    out.partial = true
    out.error = `Only ${readableChars} readable characters`
  }
  return out
}

/** `blog.example.com` -> `example.com`; keeps meaningful subdomains like `docs.`. */
export function siteNameFromUrl(url: string): string | undefined {
  try {
    return bareHost(new URL(url).hostname)
  } catch {
    return undefined
  }
}

/** Metadata-only result when the page could not be read at all (the link is still kept). */
export function unreadable(item: Item, reason: string, provisional: UrlSubtype): ExtractedContent {
  return {
    text: '',
    meta: { unreadable: reason, siteName: siteNameFromUrl(item.url ?? '') ?? null },
    truncated: false,
    partial: true,
    error: reason,
    item: { subtype: provisional }
  }
}

/** Generic adapter body. Also used by the specialised adapters as their fallback. */
export async function extractGeneric(
  item: Item,
  deps: ExtractionDeps,
  detected: DetectedUrl
): Promise<ExtractedContent> {
  const provisional = subtypeForUrl(detected)
  const { page: first, raw } = await acquireHtml(item, deps)

  // Binary answers: PDFs are kept, images become the item's own picture.
  if (raw?.bytes && isPdfType(raw.contentType)) return keepPdfFromUrl(raw.bytes, item, raw.finalUrl, deps)
  if (raw?.bytes && isImageType(raw.contentType)) {
    const info = parseImageInfo(raw.bytes)
    const out: ExtractedContent = {
      text: '',
      meta: { og: { image: raw.finalUrl }, urlKind: 'image', contentType: raw.contentType },
      truncated: false,
      item: { subtype: 'generic', mimeType: raw.contentType.split(';')[0] ?? null }
    }
    if (info?.width && info.height) out.dims = { width: info.width, height: info.height }
    return out
  }
  if (raw?.oversized) return unreadable(item, 'Download too large', provisional)

  // Network failure with nothing cached: throw so the scheduler retries with backoff.
  if (!first && raw === null) throw new Error(`Could not reach ${detected.host || 'the site'}`)

  let page = first
  let analysis = page ? await runHtmlAnalysis(page.html, page.finalUrl, deps) : null
  const readableChars = analysis?.readable?.length ?? 0
  if ((!page || readableChars < EXTRACTION_BUDGET.readableThreshold) && deps.pageFetcher && page?.via !== 'cache') {
    const dom = await acquireDom(item, deps)
    if (dom) {
      const domAnalysis = await runHtmlAnalysis(dom.html, dom.finalUrl, deps)
      if (!analysis || (domAnalysis.readable?.length ?? 0) > readableChars) {
        page = dom
        analysis = domAnalysis
      }
    }
  }
  if (!page || !analysis) {
    const status = raw?.status ?? 0
    return {
      ...unreadable(item, status >= 400 ? `HTTP ${status}` : 'Empty response', provisional),
      meta: { unreadable: status >= 400 ? `HTTP ${status}` : 'Empty response', httpStatus: status || null },
      error: COPY.cantReadPage
    }
  }
  await remember(item, page, deps)
  return contentFromAnalysis(item, analysis, page, provisional, { urlKind: detected.kind })
}
