import type { UrlSubtype } from '../../../shared/types'

/**
 * Table-driven URL classification shared by intake (provisional subtype) and the URL adapters
 * (which adapter runs). `UrlKind` is finer than `UrlSubtype`: GitHub issues/PRs and arXiv have
 * their own adapters but map onto the closed subtype vocabulary.
 */
export type UrlKind =
  | 'github_repo'
  | 'github_issue'
  | 'github_pr'
  | 'github_other'
  | 'youtube'
  | 'tweet'
  | 'arxiv'
  | 'pdf'
  | 'generic'

export interface DetectedUrl {
  kind: UrlKind
  host: string
  path: string
  owner?: string
  repo?: string
  number?: number
  videoId?: string
  arxivId?: string
  /** For arXiv: the abs page URL regardless of the input form. */
  absUrl?: string
}

const SOCIAL_HOSTS = new Set([
  'linkedin.com',
  'instagram.com',
  'facebook.com',
  'reddit.com',
  'threads.net',
  'bsky.app',
  'mastodon.social',
  'tiktok.com',
  'news.ycombinator.com',
  'lobste.rs'
])

const PRODUCT_HOSTS = new Set(['amazon.com', 'apps.apple.com', 'producthunt.com', 'etsy.com', 'ebay.com'])

/** Lower-case host without `www.`/`m.`/`mobile.`. */
export function bareHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^(www|m|mobile)\./, '')
}

/** Classify a URL (any http(s) URL; invalid input -> generic). */
export function detectUrlKind(raw: string): DetectedUrl {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { kind: 'generic', host: '', path: '' }
  }
  const host = bareHost(url.hostname)
  const path = url.pathname.replace(/\/+$/, '')
  const parts = path.split('/').filter(Boolean)
  const base: DetectedUrl = { kind: 'generic', host, path }

  if (host === 'github.com' || host === 'gist.github.com') {
    if (host === 'github.com' && parts.length >= 2) {
      const [owner, repo] = parts as [string, string, ...string[]]
      const rest = parts.slice(2)
      const cleanRepo = repo.replace(/\.git$/, '')
      if (rest.length === 0 || (rest.length === 2 && rest[0] === 'tree'))
        return { ...base, kind: 'github_repo', owner, repo: cleanRepo }
      if (rest.length === 2 && (rest[0] === 'issues' || rest[0] === 'pull') && /^\d+$/.test(rest[1] ?? '')) {
        return {
          ...base,
          kind: rest[0] === 'issues' ? 'github_issue' : 'github_pr',
          owner,
          repo: cleanRepo,
          number: Number(rest[1])
        }
      }
      return { ...base, kind: 'github_other', owner, repo: cleanRepo }
    }
    return { ...base, kind: 'github_other' }
  }

  if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'youtu.be') {
    let videoId: string | undefined
    if (host === 'youtu.be') videoId = parts[0]
    else if (path === '/watch') videoId = url.searchParams.get('v') ?? undefined
    else if (parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live') videoId = parts[1]
    return videoId ? { ...base, kind: 'youtube', videoId } : base
  }

  if ((host === 'twitter.com' || host === 'x.com') && parts.length >= 3 && parts[1] === 'status') {
    return { ...base, kind: 'tweet' }
  }

  if (host === 'arxiv.org' || host === 'export.arxiv.org') {
    const m = /^\/(?:abs|pdf|html)\/([a-z-]+\/\d{7}|\d{4}\.\d{4,5})(v\d+)?(?:\.pdf)?$/i.exec(path)
    if (m?.[1]) {
      const arxivId = m[1] + (m[2] ?? '')
      return { ...base, kind: 'arxiv', arxivId, absUrl: `https://arxiv.org/abs/${arxivId}` }
    }
  }

  if (/\.pdf$/i.test(path)) return { ...base, kind: 'pdf' }
  return base
}

/** Provisional `UrlSubtype` from the URL alone (refined by the adapters after fetching). */
export function subtypeForUrl(detected: DetectedUrl): UrlSubtype {
  switch (detected.kind) {
    case 'github_repo':
      return 'github_repo'
    case 'youtube':
      return 'youtube'
    case 'tweet':
      return 'tweet'
    case 'arxiv':
      return 'paper'
    case 'pdf':
      return 'paper'
    case 'github_issue':
    case 'github_pr':
    case 'github_other':
      return 'generic'
    case 'generic':
      break
  }
  const { host, path } = detected
  if (host === 'youtube.com') return 'youtube'
  if (host === 'figma.com') return 'figma'
  if (SOCIAL_HOSTS.has(host)) return 'social'
  if (PRODUCT_HOSTS.has(host)) return 'product'
  if (/^docs?\./.test(host) || /(^|\/)(docs?|documentation|reference|api-reference)(\/|$)/.test(path)) return 'docs'
  if (/^(readthedocs\.io|developer\.mozilla\.org)$/.test(host) || host.endsWith('.readthedocs.io')) return 'docs'
  return 'generic'
}

/** Guess a subtype from fetched page facts (og:type, JSON-LD types, readable length). */
export function refineSubtype(
  provisional: UrlSubtype,
  facts: { ogType?: string; jsonLdTypes?: string[]; readableChars: number }
): UrlSubtype {
  if (provisional !== 'generic') return provisional
  const og = (facts.ogType ?? '').toLowerCase()
  const ld = (facts.jsonLdTypes ?? []).map((t) => t.toLowerCase())
  if (og.startsWith('product') || ld.some((t) => t === 'product' || t === 'offer' || t === 'softwareapplication'))
    return 'product'
  if (og === 'article' || ld.some((t) => t.endsWith('article') || t === 'blogposting')) return 'article'
  if (og.startsWith('video')) return 'generic'
  if (facts.readableChars >= 1500) return 'article'
  return 'generic'
}
