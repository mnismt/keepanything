/**
 * `<head>` metadata of a fetched page: title, description, canonical URL, site name, favicon,
 * og:image/og:type, published date, byline, language and JSON-LD types. Pure; linkedom is loaded
 * lazily so the main bundle does not pay for it until the first URL.
 */

export interface PageMetadata {
  title?: string
  description?: string
  canonical?: string
  siteName?: string
  favicon?: string
  ogImage?: string
  ogType?: string
  publishedAt?: string
  byline?: string
  lang?: string
  jsonLdTypes?: string[]
}

/** Minimal DOM surface we use (linkedom and the real DOM both satisfy it). */
export type LinkedomDocument = {
  querySelector(selector: string): { getAttribute(name: string): string | null; textContent: string | null } | null
  querySelectorAll(
    selector: string
  ): Iterable<{ getAttribute(name: string): string | null; textContent: string | null }>
  documentElement: { getAttribute(name: string): string | null } | null
}

let linkedom: Promise<typeof import('linkedom')> | null = null
/** Result of linkedom's `parseHTML`, narrowed to what we touch. */
export type ParsedHtml = { document: LinkedomDocument }

/** Lazy linkedom import shared with `readable.ts`. */
export function loadLinkedom(): Promise<typeof import('linkedom')> {
  if (!linkedom) linkedom = import('linkedom')
  return linkedom
}

function clean(value: string | null | undefined, max = 500): string | undefined {
  if (!value) return undefined
  const s = value.replace(/\s+/g, ' ').trim()
  return s.length > 0 ? (s.length > max ? s.slice(0, max) : s) : undefined
}

function absolute(value: string | undefined, base: string): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value, base)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

function toIso(value: string | undefined): string | undefined {
  if (!value) return undefined
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) return undefined
  const year = new Date(ms).getUTCFullYear()
  return year >= 1990 && year <= 2100 ? new Date(ms).toISOString() : undefined
}

/** Pull metadata out of an already-parsed document (linkedom or DOM). */
export function metadataFromDocument(document: LinkedomDocument, baseUrl: string): PageMetadata {
  const meta = (selector: string): string | undefined =>
    clean(document.querySelector(selector)?.getAttribute('content'))
  const out: PageMetadata = {}

  const title =
    meta('meta[property="og:title"]') ??
    meta('meta[name="twitter:title"]') ??
    clean(document.querySelector('title')?.textContent, 300)
  if (title) out.title = title
  const description =
    meta('meta[name="description"]') ??
    meta('meta[property="og:description"]') ??
    meta('meta[name="twitter:description"]')
  if (description) out.description = description
  const canonical =
    absolute(clean(document.querySelector('link[rel="canonical"]')?.getAttribute('href')), baseUrl) ??
    absolute(meta('meta[property="og:url"]'), baseUrl)
  if (canonical) out.canonical = canonical
  const siteName = meta('meta[property="og:site_name"]') ?? meta('meta[name="application-name"]')
  if (siteName) out.siteName = siteName
  const ogImage = absolute(meta('meta[property="og:image"]') ?? meta('meta[name="twitter:image"]'), baseUrl)
  if (ogImage) out.ogImage = ogImage
  const ogType = meta('meta[property="og:type"]')
  if (ogType) out.ogType = ogType.toLowerCase()
  const lang = clean(document.documentElement?.getAttribute('lang'), 16)
  if (lang) out.lang = lang

  // Favicon: prefer an explicit icon link (largest declared size), else /favicon.ico.
  let favicon: string | undefined
  let bestSize = -1
  for (const link of document.querySelectorAll(
    'link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="shortcut icon"]'
  )) {
    const href = absolute(clean(link.getAttribute('href'), 2000), baseUrl)
    if (!href) continue
    const rel = (link.getAttribute('rel') ?? '').toLowerCase()
    const sizes = link.getAttribute('sizes') ?? ''
    const size = rel.includes('apple-touch') ? 180 : Number(/(\d+)x\d+/.exec(sizes)?.[1] ?? '32')
    if (size > bestSize && size <= 512) {
      bestSize = size
      favicon = href
    }
  }
  out.favicon = favicon ?? absolute('/favicon.ico', baseUrl)

  const published =
    meta('meta[property="article:published_time"]') ??
    meta('meta[name="article:published_time"]') ??
    meta('meta[name="date"]') ??
    meta('meta[name="pubdate"]') ??
    meta('meta[name="publish_date"]') ??
    meta('meta[property="og:updated_time"]') ??
    meta('meta[name="citation_date"]') ??
    meta('meta[name="citation_publication_date"]') ??
    meta('meta[name="dc.date"]') ??
    meta('meta[name="DC.date.issued"]') ??
    clean(document.querySelector('time[datetime]')?.getAttribute('datetime'))
  const publishedAt = toIso(published)
  if (publishedAt) out.publishedAt = publishedAt

  const byline =
    meta('meta[name="author"]') ?? meta('meta[property="article:author"]') ?? meta('meta[name="twitter:creator"]')
  if (byline && !/^https?:/.test(byline)) out.byline = byline.replace(/^@/, '')

  // JSON-LD: @type values, plus datePublished / author.name when the head had none.
  const types: string[] = []
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    const raw = script.textContent
    if (!raw || raw.length > 200_000) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      continue
    }
    const nodes: unknown[] = Array.isArray(parsed) ? parsed : [parsed]
    for (const node of nodes) {
      if (typeof node !== 'object' || node === null) continue
      const obj = node as Record<string, unknown>
      const graph = Array.isArray(obj['@graph']) ? (obj['@graph'] as unknown[]) : []
      for (const candidate of [obj, ...graph]) {
        if (typeof candidate !== 'object' || candidate === null) continue
        const c = candidate as Record<string, unknown>
        const type = c['@type']
        if (typeof type === 'string') types.push(type)
        else if (Array.isArray(type)) types.push(...type.filter((t): t is string => typeof t === 'string'))
        if (!out.publishedAt) {
          const date = toIso(typeof c.datePublished === 'string' ? c.datePublished : undefined)
          if (date) out.publishedAt = date
        }
        if (!out.byline) {
          const author = c.author
          const name =
            typeof author === 'string'
              ? author
              : typeof author === 'object' && author !== null
                ? Array.isArray(author)
                  ? (author[0] as Record<string, unknown> | undefined)?.name
                  : (author as Record<string, unknown>).name
                : undefined
          if (typeof name === 'string' && clean(name)) out.byline = clean(name, 120)
        }
      }
    }
  }
  if (types.length > 0) out.jsonLdTypes = [...new Set(types)].slice(0, 10)
  return out
}

export async function parsePageMetadata(html: string, baseUrl: string): Promise<PageMetadata> {
  const { parseHTML } = await loadLinkedom()
  const { document } = parseHTML(html) as unknown as { document: LinkedomDocument }
  return metadataFromDocument(document, baseUrl)
}
