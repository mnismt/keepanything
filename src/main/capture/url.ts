import { extname } from 'node:path'
import type { UrlSubtype } from '../../shared/types'
import { detectUrlKind, subtypeForUrl } from '../extraction/url/detect'

/**
 * Table-driven URL canonicalization for dedupe plus the small URL
 * helpers intake needs.
 */

/** Query keys that never identify content (analytics, referral, share tokens). */
const TRACKING_PARAM =
  /^(utm_\w*|fbclid|gclid|gclsrc|dclid|msclkid|yclid|twclid|ttclid|igshid|igsh|mc_cid|mc_eid|_hsenc|_hsmi|__hstc|__hssc|__hsfp|hsCtaTracking|ref|ref_src|ref_url|referrer|source|_ga|_gl|oly_anon_id|oly_enc_id|vero_id|vero_conv|wickedid|mkt_tok|trk|trkCampaign|sc_campaign|sc_channel|spm|share_id|si|feature|s|t|cmpid|ncid|ocid|pk_campaign|pk_kwd|piwik_\w+|mtm_\w+|_openstat)$/i

/** Which query keys carry meaning (everything else is dropped). */
const KEEP_ONLY: Record<string, readonly string[]> = {
  'youtube.com': ['v', 'list'],
  'twitter.com': [],
  'amazon.com': [],
  'google.com': ['q'],
  'duckduckgo.com': ['q'],
  'bing.com': ['q'],
  'reddit.com': [],
  'medium.com': [],
  'linkedin.com': []
}

const HOST_ALIASES: Record<string, string> = {
  'youtu.be': 'youtube.com',
  'music.youtube.com': 'youtube.com',
  'x.com': 'twitter.com',
  'nitter.net': 'twitter.com',
  'mobile.twitter.com': 'twitter.com',
  'old.reddit.com': 'reddit.com',
  'new.reddit.com': 'reddit.com',
  'np.reddit.com': 'reddit.com',
  'en.m.wikipedia.org': 'en.wikipedia.org'
}

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'avif', 'bmp', 'tiff', 'tif', 'svg'])
const MEDIA_EXT = new Set(['mp4', 'mov', 'webm', 'm4v', 'mp3', 'm4a', 'wav', 'aac', 'ogg'])

export interface CanonicalUrl {
  /** The URL as given (normalised by `URL`), stored in `items.url`. */
  url: string
  /** Dedupe key, stored in `items.canonical_url`. */
  canonical: string
  /** Canonical host without `www.`/`m.`, stored in `items.domain`. */
  domain: string
}

/**
 * Lower-case host, drop `www.`/`m.`/`mobile.`, collapse aliases (`youtu.be` ->
 * `youtube.com/watch?v=`, `x.com` -> `twitter.com`), drop tracking params (or keep only the
 * meaningful keys for known hosts), sort the rest, strip the default port and trailing slashes,
 * drop the fragment unless it is an SPA route (`#/...`, `#!...`). Null for non-http(s) input.
 */
export function canonicalizeUrl(raw: string): CanonicalUrl | null {
  let parsed: URL
  try {
    parsed = new URL(raw.trim())
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (parsed.hostname.length === 0) return null
  const bare = parsed.hostname.toLowerCase().replace(/^(www|m|mobile|amp)\./, '')
  const host = HOST_ALIASES[bare] ?? HOST_ALIASES[parsed.hostname.toLowerCase()] ?? bare
  let path = parsed.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '')
  path = path.replace(/\/(index|default)\.(html?|php|aspx?)$/i, '')

  const params = new URLSearchParams()
  const keepOnly = KEEP_ONLY[host]
  const entries = [...parsed.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b))
  for (const [k, v] of entries) {
    if (keepOnly ? !keepOnly.includes(k) : TRACKING_PARAM.test(k)) continue
    params.append(k, v)
  }
  if (bare === 'youtu.be' && path.length > 1) {
    params.set('v', path.slice(1).split('/')[0] ?? '')
    path = '/watch'
  }
  if (host === 'youtube.com') {
    const shorts = /^\/(shorts|live|embed)\/([\w-]+)$/.exec(path)
    if (shorts?.[2]) {
      params.set('v', shorts[2])
      path = '/watch'
    }
    if (path === '/watch') {
      const v = params.get('v')
      params.delete('list')
      if (v) params.set('v', v)
    }
  }
  const fragment = /^#(\/|!)/.test(parsed.hash) ? parsed.hash : ''
  const query = params.toString()
  const canonical = `https://${host}${path}${query ? `?${query}` : ''}${fragment}`
  return { url: parsed.toString(), canonical, domain: host }
}

/** Provisional URL subtype from host/path alone (refined after fetching). */
export function guessUrlSubtype(domain: string, path: string): UrlSubtype {
  return subtypeForUrl(detectUrlKind(`https://${domain}${path.startsWith('/') ? path : `/${path}`}`))
}

/** True for URLs that point at image/media files (browser image drags). */
export function isMediaUrl(url: string): boolean {
  try {
    const ext = extname(new URL(url).pathname).slice(1).toLowerCase()
    return IMAGE_EXT.has(ext) || MEDIA_EXT.has(ext)
  } catch {
    return false
  }
}

/** True when `text` is exactly one http(s) URL. */
export function isSingleUrl(text: string): boolean {
  return /^https?:\/\/\S+$/.test(text.trim()) && canonicalizeUrl(text) !== null
}

/** Parse `text/uri-list`: one URL per line, `#` comments and blanks skipped. */
export function parseUriList(uriList: string): string[] {
  return uriList
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))
}

/** Human title from a URL when the page has not been read yet. */
export function titleFromUrl(url: URL): string {
  let path = ''
  try {
    path = decodeURIComponent(url.pathname).replace(/\/+$/, '')
  } catch {
    path = url.pathname.replace(/\/+$/, '')
  }
  const host = url.hostname.replace(/^www\./, '')
  if (path.length <= 1) return host
  const last = path.split('/').filter(Boolean).pop() ?? ''
  const pretty = last
    .replace(/\.(html?|php|aspx?|pdf)$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim()
  return pretty.length > 0 ? `${pretty} · ${host}` : host
}
