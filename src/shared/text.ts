/**
 * Pure text helpers used on both sides of the bridge. No imports.
 */

/** Shorten `s` to at most `n` characters, appending `…` when cut. */
export function truncate(s: string, n: number): string {
  if (n <= 0) return ''
  if (s.length <= n) return s
  if (n === 1) return '…'
  return `${s.slice(0, n - 1).trimEnd()}…`
}

/** URL/file-safe slug: lowercase ASCII letters, digits and single dashes. */
export function slugify(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Normalized comparison key for names (`collections.name_key`): lowercase, punctuation and
 * symbols removed, whitespace collapsed, trimmed.
 */
export function normalizeName(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY
const MONTH = 30 * DAY
const YEAR = 365 * DAY

/** Human relative time ("just now", "3 weeks ago"). Future or invalid dates read as "just now". */
export function relativeTime(iso: string, nowIso: string): string {
  const then = Date.parse(iso)
  const now = Date.parse(nowIso)
  if (!Number.isFinite(then) || !Number.isFinite(now)) return 'just now'
  const diff = now - then
  if (diff < 45_000) return 'just now'
  if (diff < 90_000) return '1 minute ago'
  if (diff < 45 * MINUTE) return `${Math.round(diff / MINUTE)} minutes ago`
  if (diff < 90 * MINUTE) return '1 hour ago'
  if (diff < 22 * HOUR) return `${Math.round(diff / HOUR)} hours ago`
  if (diff < 36 * HOUR) return 'yesterday'
  if (diff < WEEK) return `${Math.round(diff / DAY)} days ago`
  if (diff < 11 * DAY) return '1 week ago'
  if (diff < 30 * DAY) return `${Math.round(diff / WEEK)} weeks ago`
  if (diff < 45 * DAY) return '1 month ago'
  if (diff < 320 * DAY) return `${Math.round(diff / MONTH)} months ago`
  if (diff < 548 * DAY) return '1 year ago'
  return `${Math.round(diff / YEAR)} years ago`
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/** Decimal (1000-based, like Finder) size string: "0 B", "12 KB", "2.4 MB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes < 1000) return `${Math.round(bytes)} B`
  let value = bytes
  let unit = 0
  while (value >= 1000 && unit < BYTE_UNITS.length - 1) {
    value /= 1000
    unit += 1
  }
  const text = value >= 100 || Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)
  return `${text} ${BYTE_UNITS[unit]}`
}

/** Media duration as `m:ss` or `h:mm:ss`. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0:00'
  const total = Math.round(ms / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const two = (n: number): string => n.toString().padStart(2, '0')
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`
}

const QUESTION_WORDS = new Set([
  'what',
  'which',
  'where',
  'when',
  'who',
  'whose',
  'whom',
  'how',
  'why',
  'show',
  'find',
  'list',
  'tell',
  'did',
  'do',
  'does',
  'is',
  'are',
  'was',
  'were',
  'can',
  'could',
  'should',
  'would',
  'have',
  'has'
])

/** ≥ 4 words, starts with a question word, or ends with `?` (drives the "Ask" row). */
export function isProbablyNaturalLanguage(query: string): boolean {
  const trimmed = query.trim()
  if (trimmed.length === 0) return false
  if (trimmed.endsWith('?')) return true
  const words = tokenize(trimmed)
  if (words.length >= 4) return true
  const first = words[0]
  return first !== undefined && QUESTION_WORDS.has(first)
}

/** Lowercase alphanumeric tokens, Unicode-aware (letters and digits of any script). */
export function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length > 0)
}
