import { EXTRACTION_BUDGET, type FetchLike } from '../types'

/**
 * Plain HTTP acquisition for the URL adapters: desktop UA, timeout, size caps, PDF/image bodies
 * as bytes, HTML as text. Injected `fetchImpl` keeps tests offline.
 */

/** Desktop Safari UA so sites serve their normal page. */
export const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'

export interface FetchedPage {
  status: number
  finalUrl: string
  contentType: string
  /** Text body for HTML/XML/JSON responses; null otherwise. */
  html: string | null
  /** Raw body for PDFs/images (≤ `maxDownloadBytes`); null otherwise. */
  bytes: Uint8Array | null
  /** True when the body was not read because it exceeded the caps. */
  oversized: boolean
}

export interface FetchPageOptions {
  fetchImpl?: FetchLike
  timeoutMs?: number
  signal?: AbortSignal
  /** Read binary bodies (PDF/images); default true. */
  wantBytes?: boolean
  headers?: Record<string, string>
}

export function combineSignals(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

/** Media type without parameters, lower case. */
export function mediaType(contentType: string): string {
  return (contentType.split(';')[0] ?? '').trim().toLowerCase()
}

export function isHtmlType(contentType: string): boolean {
  const type = mediaType(contentType)
  return type === '' || type.startsWith('text/') || /xml|xhtml|json/.test(type)
}

export function isPdfType(contentType: string): boolean {
  return mediaType(contentType) === 'application/pdf'
}

export function isImageType(contentType: string): boolean {
  return mediaType(contentType).startsWith('image/')
}

/** GET a URL. Returns null on network failure (DNS, offline, timeout) so callers can decide to retry. */
export async function fetchPage(url: string, opts: FetchPageOptions = {}): Promise<FetchedPage | null> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const timeoutMs = opts.timeoutMs ?? EXTRACTION_BUDGET.fetchTimeoutMs
  let response: Response
  try {
    response = await fetchImpl(url, {
      headers: {
        'User-Agent': DESKTOP_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf;q=0.9,image/*;q=0.8,*/*;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9',
        ...(opts.headers ?? {})
      },
      redirect: 'follow',
      signal: combineSignals(opts.signal, timeoutMs)
    })
  } catch {
    if (opts.signal?.aborted) throw new Error('Fetch cancelled')
    return null
  }
  const contentType = response.headers.get('content-type') ?? ''
  const finalUrl = response.url || url
  const page: FetchedPage = {
    status: response.status,
    finalUrl,
    contentType,
    html: null,
    bytes: null,
    oversized: false
  }
  const declared = Number(response.headers.get('content-length') ?? '0')
  try {
    if (isHtmlType(contentType)) {
      const text = await response.text()
      page.html = text.length > EXTRACTION_BUDGET.htmlMaxChars ? text.slice(0, EXTRACTION_BUDGET.htmlMaxChars) : text
    } else if (opts.wantBytes !== false && (isPdfType(contentType) || isImageType(contentType))) {
      if (declared > EXTRACTION_BUDGET.maxDownloadBytes) {
        page.oversized = true
        await response.body?.cancel().catch(() => undefined)
      } else {
        const bytes = new Uint8Array(await response.arrayBuffer())
        if (bytes.byteLength > EXTRACTION_BUDGET.maxDownloadBytes) page.oversized = true
        else page.bytes = bytes
      }
    } else {
      await response.body?.cancel().catch(() => undefined)
    }
  } catch {
    if (opts.signal?.aborted) throw new Error('Fetch cancelled')
    return page.html === null && page.bytes === null ? null : page
  }
  return page
}

/** GET JSON (public APIs). Returns `{ status, json }`; `json` null when the body is not JSON. Null on network failure. */
export async function fetchJson<T = unknown>(
  url: string,
  opts: FetchPageOptions = {}
): Promise<{ status: number; json: T | null } | null> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const timeoutMs = opts.timeoutMs ?? EXTRACTION_BUDGET.fetchTimeoutMs
  try {
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': DESKTOP_USER_AGENT, Accept: 'application/json', ...(opts.headers ?? {}) },
      redirect: 'follow',
      signal: combineSignals(opts.signal, timeoutMs)
    })
    let json: T | null = null
    try {
      json = (await response.json()) as T
    } catch {
      json = null
    }
    return { status: response.status, json }
  } catch {
    if (opts.signal?.aborted) throw new Error('Fetch cancelled')
    return null
  }
}

/** GET a text body (raw README etc.). Null on network failure. */
export async function fetchText(
  url: string,
  opts: FetchPageOptions = {}
): Promise<{ status: number; text: string } | null> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const timeoutMs = opts.timeoutMs ?? EXTRACTION_BUDGET.fetchTimeoutMs
  try {
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': DESKTOP_USER_AGENT, ...(opts.headers ?? {}) },
      redirect: 'follow',
      signal: combineSignals(opts.signal, timeoutMs)
    })
    return { status: response.status, text: await response.text() }
  } catch {
    if (opts.signal?.aborted) throw new Error('Fetch cancelled')
    return null
  }
}
