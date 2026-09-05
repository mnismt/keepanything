import { EXTRACTION_BUDGET } from '../types'
import { type LinkedomDocument, loadLinkedom, metadataFromDocument, type PageMetadata } from './metadata'

/**
 * HTML -> readable article: linkedom DOM, Mozilla Readability, Turndown to Markdown. CPU-heavy on
 * large pages, so the worker runs it (`extract.html`); the same function serves as the in-process
 * fallback. All three libraries are loaded lazily.
 */

export interface ReadableResult {
  title?: string
  byline?: string
  excerpt?: string
  siteName?: string
  publishedTime?: string
  /** Plain text of the article body. */
  text: string
  /** Markdown of the article body (capped). */
  markdown: string
  /** Readable character count (Readability's `length`). */
  length: number
}

/** What `extract.html` returns. */
export interface HtmlAnalysis {
  metadata: PageMetadata
  readable: ReadableResult | null
}

let readabilityModule: Promise<typeof import('@mozilla/readability')> | null = null
/** Turndown's `export =` class, as seen through a dynamic import. */
type TurndownModule = {
  default: new (
    options?: Record<string, unknown>
  ) => {
    turndown(html: string): string
    remove(tags: string[]): unknown
  }
}
let turndownModule: Promise<TurndownModule> | null = null

function loadReadability(): Promise<typeof import('@mozilla/readability')> {
  if (!readabilityModule) readabilityModule = import('@mozilla/readability')
  return readabilityModule
}
function loadTurndown(): Promise<TurndownModule> {
  if (!turndownModule) turndownModule = import('turndown') as unknown as Promise<TurndownModule>
  return turndownModule
}

function clean(value: string | null | undefined, max = 500): string | undefined {
  if (!value) return undefined
  const s = value.replace(/\s+/g, ' ').trim()
  return s.length > 0 ? s.slice(0, max) : undefined
}

export async function htmlToMarkdown(articleHtml: string): Promise<string> {
  const TurndownService = (await loadTurndown()).default
  const service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '_',
    hr: '---'
  })
  service.remove(['script', 'style', 'noscript', 'iframe', 'form', 'button', 'svg'])
  const markdown = service.turndown(articleHtml)
  return markdown
    .replace(/^([ \t]*)- {3}/gm, '$1- ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, EXTRACTION_BUDGET.contentFileChars)
}

/** Parse + metadata + Readability + Markdown in one pass over one DOM. */
export async function analyzeHtml(html: string, url: string): Promise<HtmlAnalysis> {
  const { parseHTML } = await loadLinkedom()
  const { document } = parseHTML(
    html.length > EXTRACTION_BUDGET.htmlMaxChars ? html.slice(0, EXTRACTION_BUDGET.htmlMaxChars) : html
  ) as unknown as { document: LinkedomDocument }
  // biome-ignore lint/suspicious/noExplicitAny: linkedom's Document is structurally DOM-compatible for our selectors.
  const doc = document as any
  const metadata = metadataFromDocument(doc, url)
  let readable: ReadableResult | null = null
  try {
    const { Readability } = await loadReadability()
    // Readability mutates the document; metadata was read first.
    const article = new Readability(doc, { charThreshold: 200, keepClasses: false }).parse()
    if (article?.content && (article.textContent ?? '').trim().length > 0) {
      const markdown = await htmlToMarkdown(article.content)
      const text = (article.textContent ?? '')
        .replace(/[ \t ]+/g, ' ')
        .replace(/\s*\n\s*/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
      readable = { text, markdown, length: article.length ?? text.length }
      const title = clean(article.title, 300)
      const byline = clean(article.byline, 200)
      const excerpt = clean(article.excerpt, 500)
      const siteName = clean(article.siteName, 120)
      const publishedTime = clean(article.publishedTime, 64)
      if (title) readable.title = title
      if (byline) readable.byline = byline
      if (excerpt) readable.excerpt = excerpt
      if (siteName) readable.siteName = siteName
      if (publishedTime) readable.publishedTime = publishedTime
    }
  } catch {
    readable = null
  }
  return { metadata, readable }
}
