/**
 * Query understanding for retrieval. Pure: turns the text a person
 * typed into content tokens for FTS (stopwords and cue words removed, quoted phrases kept), memory
 * cues (type / subtype / kind words, time phrases) and a safe FTS5 MATCH expression. Raw text is
 * never forwarded to MATCH; every token is quoted.
 */

import { isKind } from '../../shared/kinds'
import { tokenize } from '../../shared/text'
import type { ItemSubtype, ItemType, Kind, SearchFilters } from '../../shared/types'

/** A soft time window on `captured_at`. */
export interface TimeCue {
  since?: string
  until?: string
  label: string
}

/** Cues extracted from a query. Type cues are soft boosts unless `strict`. */
export interface QueryCues {
  types: ItemType[]
  subtypes: ItemSubtype[]
  kinds: Kind[]
  domains: string[]
  timeframe?: TimeCue
  /** True when the person asked for notes ("my notes"); generated notes are then included. */
  noteCue: boolean
  strict: boolean
}

export interface ParsedQuery {
  raw: string
  /** Lower-cased content tokens for FTS (stopwords / cue words removed). */
  tokens: string[]
  /** Quoted phrases, each as its tokens. */
  phrases: string[][]
  /** Tokens that were recognised as cues (kept for the FTS fallback when nothing else remains). */
  cueTokens: string[]
  cues: QueryCues
  /** Text embedded for the vector leg: the original wording minus grammar operators. */
  embedText: string
}

const DAY_MS = 86_400_000

const STOPWORDS = new Set(
  (
    'a an the and or but if then else of to in on at by for with from as is are was were be been being this that these those ' +
    'it its into over under about after before between during through up down out off again further once here there when ' +
    'where why how all any both each few more most other some such no nor not only own same so than too very can will just ' +
    'should now you your yours we our ours they them their he she his her i me my mine what which who whom whose have has had ' +
    'do does did done also like get got make made one thing things stuff something someone anything everything saved save ' +
    'kept keep keeping remember remembered find show tell give looking look want wanted need needed please something ' +
    'somewhere ago last recent recently lately earlier'
  ).split(/\s+/)
)

/** Cue words -> type/subtype/kind cues. Words listed here are removed from the FTS tokens. */
const TYPE_CUES: Record<string, Partial<Pick<QueryCues, 'types' | 'subtypes' | 'kinds'>>> = {
  website: { types: ['url'] },
  websites: { types: ['url'] },
  site: { types: ['url'] },
  page: { types: ['url'] },
  webpage: { types: ['url'] },
  link: { types: ['url'] },
  links: { types: ['url'] },
  url: { types: ['url'] },
  pdf: { types: ['pdf'] },
  pdfs: { types: ['pdf'] },
  repo: { types: ['url'], subtypes: ['github_repo'] },
  repos: { types: ['url'], subtypes: ['github_repo'] },
  repository: { types: ['url'], subtypes: ['github_repo'] },
  repositories: { types: ['url'], subtypes: ['github_repo'] },
  github: { types: ['url'], subtypes: ['github_repo'] },
  screenshot: { types: ['image'], subtypes: ['screenshot'] },
  screenshots: { types: ['image'], subtypes: ['screenshot'] },
  image: { types: ['image'] },
  images: { types: ['image'] },
  picture: { types: ['image'] },
  pictures: { types: ['image'] },
  photo: { types: ['image'] },
  photos: { types: ['image'] },
  pic: { types: ['image'] },
  app: { kinds: ['macos_app', 'cli_tool', 'saas_product'] },
  apps: { kinds: ['macos_app', 'cli_tool', 'saas_product'] },
  application: { kinds: ['macos_app', 'cli_tool', 'saas_product'] },
  tool: { kinds: ['macos_app', 'cli_tool', 'saas_product'] },
  tools: { kinds: ['macos_app', 'cli_tool', 'saas_product'] },
  video: { types: ['video', 'url'], subtypes: ['youtube'], kinds: ['video'] },
  videos: { types: ['video', 'url'], subtypes: ['youtube'], kinds: ['video'] },
  youtube: { types: ['video', 'url'], subtypes: ['youtube'], kinds: ['video'] },
  talk: { kinds: ['video'] },
  folder: { types: ['folder'] },
  folders: { types: ['folder'] },
  directory: { types: ['folder'] },
  note: { types: ['note'], kinds: ['note'] },
  notes: { types: ['note'], kinds: ['note'] },
  paper: { kinds: ['paper'] },
  papers: { kinds: ['paper'] },
  article: { kinds: ['article'] },
  articles: { kinds: ['article'] },
  blog: { kinds: ['article'] },
  post: { kinds: ['article', 'social_post'] },
  docs: { kinds: ['docs'] },
  documentation: { kinds: ['docs'] },
  receipt: { kinds: ['receipt'] },
  receipts: { kinds: ['receipt'] },
  invoice: { kinds: ['receipt'] },
  tweet: { subtypes: ['tweet'], kinds: ['social_post'] },
  thread: { kinds: ['social_post'] }
}

/** Words that only refine a cue ("mac app") and should not be searched on their own. */
const CUE_MODIFIERS: Record<string, Partial<Pick<QueryCues, 'kinds'>>> = {
  mac: { kinds: ['macos_app'] },
  macos: { kinds: ['macos_app'] }
}

const SYNONYMS: Record<string, string[]> = {
  app: ['application'],
  application: ['app'],
  mac: ['macos'],
  macos: ['mac'],
  repo: ['repository'],
  repository: ['repo'],
  pic: ['image', 'photo'],
  photo: ['image'],
  picture: ['image'],
  js: ['javascript'],
  javascript: ['js']
}

interface TimePattern {
  pattern: RegExp
  window: (m: RegExpMatchArray) => { sinceDays?: number; untilDays?: number }
}

const TIME_PATTERNS: TimePattern[] = [
  { pattern: /\btoday\b/, window: () => ({ sinceDays: 1 }) },
  { pattern: /\byesterday\b/, window: () => ({ sinceDays: 2 }) },
  { pattern: /\bthis week\b/, window: () => ({ sinceDays: 7 }) },
  { pattern: /\b(?:last|past) week\b/, window: () => ({ sinceDays: 14 }) },
  { pattern: /\bthis month\b/, window: () => ({ sinceDays: 31 }) },
  { pattern: /\b(?:last|past) month\b/, window: () => ({ sinceDays: 45 }) },
  { pattern: /\b(?:last|past) year\b/, window: () => ({ sinceDays: 400 }) },
  { pattern: /\b(?:a )?(?:few|couple(?: of)?) (?:of )?weeks ago\b/, window: () => ({ sinceDays: 35, untilDays: 10 }) },
  { pattern: /\b(?:a )?(?:few|couple(?: of)?) (?:of )?days ago\b/, window: () => ({ sinceDays: 10, untilDays: 1 }) },
  {
    pattern: /\b(?:a )?(?:few|couple(?: of)?) (?:of )?months ago\b/,
    window: () => ({ sinceDays: 120, untilDays: 45 })
  },
  { pattern: /\b(?:a|one) week ago\b/, window: () => ({ sinceDays: 12, untilDays: 4 }) },
  { pattern: /\b(?:a|one) month ago\b/, window: () => ({ sinceDays: 45, untilDays: 18 }) },
  {
    pattern: /\b(\d{1,3}) days? ago\b/,
    window: (m) => {
      const n = Number(m[1])
      return { sinceDays: n + 2, untilDays: Math.max(0, n - 2) }
    }
  },
  {
    pattern: /\b(\d{1,2}) weeks? ago\b/,
    window: (m) => {
      const n = Number(m[1])
      return { sinceDays: n * 7 + 5, untilDays: Math.max(0, n * 7 - 5) }
    }
  },
  {
    pattern: /\b(\d{1,2}) months? ago\b/,
    window: (m) => {
      const n = Number(m[1])
      return { sinceDays: n * 30 + 15, untilDays: Math.max(0, n * 30 - 15) }
    }
  },
  { pattern: /\brecently\b|\blately\b|\bthe other day\b/, window: () => ({ sinceDays: 21 }) }
]

export function parseTimeCue(lower: string, now: Date): TimeCue | null {
  for (const entry of TIME_PATTERNS) {
    const match = lower.match(entry.pattern)
    if (!match) continue
    const { sinceDays, untilDays } = entry.window(match)
    const cue: TimeCue = { label: match[0] }
    if (sinceDays !== undefined) cue.since = new Date(now.getTime() - sinceDays * DAY_MS).toISOString()
    if (untilDays !== undefined && untilDays > 0) cue.until = new Date(now.getTime() - untilDays * DAY_MS).toISOString()
    return cue
  }
  return null
}

const ITEM_TYPES: readonly ItemType[] = [
  'file',
  'folder',
  'image',
  'video',
  'audio',
  'pdf',
  'text',
  'markdown',
  'url',
  'note',
  'unknown'
]

function pushUnique<T>(list: T[], values: readonly T[] | undefined): void {
  if (!values) return
  for (const v of values) if (!list.includes(v)) list.push(v)
}

/** Parse a query into tokens, phrases and cues. `filters` (agent / dynamic collections) are merged in. */
export function parseQuery(raw: string, now: Date, filters: SearchFilters = {}): ParsedQuery {
  const cues: QueryCues = {
    types: [...(filters.types ?? [])],
    subtypes: [...(filters.subtypes ?? [])],
    kinds: [...(filters.kinds ?? [])],
    domains: [...(filters.domains ?? [])],
    noteCue: false,
    strict: filters.strict === true
  }
  if (filters.since || filters.until) {
    cues.timeframe = { label: 'filter' }
    if (filters.since) cues.timeframe.since = filters.since
    if (filters.until) cues.timeframe.until = filters.until
  }

  let text = raw.trim()
  const phrases: string[][] = []
  text = text.replace(/"([^"]+)"/g, (_m, phrase: string) => {
    const words = tokenize(phrase)
    if (words.length > 0) phrases.push(words)
    return ' '
  })
  // Own grammar: type:pdf, kind:article, since:2026-01-01 / since:7d, domain:github.com
  text = text.replace(/\b(type|kind|since|until|domain):(\S+)/gi, (_m, key: string, value: string) => {
    const v = value.toLowerCase()
    switch (key.toLowerCase()) {
      case 'type':
        if ((ITEM_TYPES as readonly string[]).includes(v)) pushUnique(cues.types, [v as ItemType])
        cues.strict = true
        break
      case 'kind':
        if (isKind(v)) pushUnique(cues.kinds, [v])
        cues.strict = true
        break
      case 'domain':
        pushUnique(cues.domains, [v.replace(/^www\./, '')])
        break
      case 'since':
      case 'until': {
        const iso = parseDateOrRelative(v, now)
        if (iso) {
          cues.timeframe = cues.timeframe ?? { label: `${key}:${value}` }
          if (key.toLowerCase() === 'since') cues.timeframe.since = iso
          else cues.timeframe.until = iso
        }
        break
      }
    }
    return ' '
  })

  const lower = text.toLowerCase()
  const time = cues.timeframe ? null : parseTimeCue(lower, now)
  if (time) {
    cues.timeframe = time
    text = text.replace(new RegExp(time.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ')
  }

  const words = tokenize(text)
  const tokens: string[] = []
  const cueTokens: string[] = []
  for (let i = 0; i < words.length; i++) {
    const word = words[i] as string
    const cue = TYPE_CUES[word]
    if (cue) {
      // "mac app" -> macos_app only; "app" alone keeps the wider kind set.
      const previous = words[i - 1]
      const modifier = previous ? CUE_MODIFIERS[previous] : undefined
      pushUnique(cues.types, cue.types)
      pushUnique(cues.subtypes, cue.subtypes)
      pushUnique(cues.kinds, modifier?.kinds ?? cue.kinds)
      if (word === 'note' || word === 'notes') cues.noteCue = true
      cueTokens.push(word)
      continue
    }
    if (CUE_MODIFIERS[word] && words[i + 1] && TYPE_CUES[words[i + 1] as string]) {
      cueTokens.push(word)
      continue
    }
    if (STOPWORDS.has(word)) continue
    if (!tokens.includes(word)) tokens.push(word)
  }
  if (cues.types.includes('note')) cues.noteCue = true

  const embedText = [text.replace(/\s+/g, ' ').trim(), ...phrases.map((p) => p.join(' '))].filter(Boolean).join(' ')
  return { raw, tokens, phrases, cueTokens, cues, embedText: embedText || raw.trim() }
}

function parseDateOrRelative(value: string, now: Date): string | null {
  const rel = /^(\d{1,4})([dwmy])$/.exec(value)
  if (rel) {
    const n = Number(rel[1])
    const unit = rel[2]
    const days = unit === 'd' ? n : unit === 'w' ? n * 7 : unit === 'm' ? n * 30 : n * 365
    return new Date(now.getTime() - days * DAY_MS).toISOString()
  }
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

export interface MatchOptions {
  /** `AND` every token group (default) or `OR` them (fallback when AND returns too little). */
  mode?: 'and' | 'or'
  /** Append `*` to the last plain token (instant path while typing). */
  prefixLast?: boolean
  /** Expand tokens with the synonym table (default true). */
  synonyms?: boolean
}

function quote(token: string): string {
  return `"${token.replace(/"/g, '')}"`
}

/**
 * Build a safe FTS5 MATCH expression. Tokens are quoted; synonyms become `("app" OR "application")`
 * groups; phrases stay phrases; the last token may take a `*` prefix. Returns null when there is
 * nothing to search for.
 */
export function buildMatch(
  parsed: Pick<ParsedQuery, 'tokens' | 'phrases' | 'cueTokens'>,
  opts: MatchOptions = {}
): string | null {
  const useSynonyms = opts.synonyms !== false
  const tokens = parsed.tokens.length > 0 ? parsed.tokens : parsed.phrases.length > 0 ? [] : parsed.cueTokens
  const groups: string[] = []
  tokens.forEach((token, index) => {
    const isLast = index === tokens.length - 1
    const variants = [token, ...(useSynonyms ? (SYNONYMS[token] ?? []) : [])]
    const parts = variants.map((v, i) =>
      i === 0 && isLast && opts.prefixLast && v.length >= 2 ? `${quote(v)}*` : quote(v)
    )
    if (isLast && opts.prefixLast && parts.length > 1 && token.length >= 2) {
      // Also match the whole word without prefix so exact hits are not lost to tokenisation.
      parts.push(quote(token))
    }
    groups.push(parts.length === 1 ? (parts[0] as string) : `(${parts.join(' OR ')})`)
  })
  for (const phrase of parsed.phrases) groups.push(quote(phrase.join(' ')))
  if (groups.length === 0) return null
  return groups.join(opts.mode === 'or' ? ' OR ' : ' AND ')
}

/** An OR query over a bag of words (topics, entities, title) for candidate retrieval. */
export function buildBagMatch(words: readonly string[], max = 24): string | null {
  const seen = new Set<string>()
  const groups: string[] = []
  for (const word of words) {
    for (const token of tokenize(word)) {
      if (token.length < 2 || STOPWORDS.has(token) || seen.has(token)) continue
      seen.add(token)
      groups.push(quote(token))
      if (groups.length === max) break
    }
    if (groups.length === max) break
  }
  return groups.length > 0 ? groups.join(' OR ') : null
}

export function isStopword(token: string): boolean {
  return STOPWORDS.has(token)
}
