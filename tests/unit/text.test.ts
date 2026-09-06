import { describe, expect, it } from 'vitest'
import {
  formatBytes,
  formatDuration,
  isProbablyNaturalLanguage,
  normalizeName,
  relativeTime,
  slugify,
  tokenize,
  truncate
} from '../../src/shared/text'

describe('truncate', () => {
  it('keeps short strings and adds an ellipsis when cutting', () => {
    expect(truncate('hello', 10)).toBe('hello')
    expect(truncate('hello', 5)).toBe('hello')
    expect(truncate('hello world', 6)).toBe('hello…')
    expect(truncate('hello world', 1)).toBe('…')
    expect(truncate('hello', 0)).toBe('')
  })
})

describe('slugify', () => {
  it('produces lowercase dash-separated ASCII', () => {
    expect(slugify('mnismt — Visual Direction!')).toBe('mnismt-visual-direction')
    expect(slugify('  Résumé 2026.pdf ')).toBe('resume-2026-pdf')
    expect(slugify('---')).toBe('')
  })
})

describe('normalizeName', () => {
  it('lowercases, strips punctuation and collapses whitespace', () => {
    expect(normalizeName('  mnismt:  Visual   Direction!! ')).toBe('mnismt visual direction')
    expect(normalizeName('MiniMax-Hackathon')).toBe('minimax hackathon')
    expect(normalizeName('Things to Read')).toBe(normalizeName('things   to read'))
    expect(normalizeName('Ｍacos Apps')).toBe('macos apps')
  })
})

describe('relativeTime', () => {
  const now = '2026-09-03T12:00:00.000Z'
  const ago = (ms: number): string => new Date(Date.parse(now) - ms).toISOString()
  it('reads like a human', () => {
    expect(relativeTime(now, now)).toBe('just now')
    expect(relativeTime(ago(30_000), now)).toBe('just now')
    expect(relativeTime(ago(60_000), now)).toBe('1 minute ago')
    expect(relativeTime(ago(5 * 60_000), now)).toBe('5 minutes ago')
    expect(relativeTime(ago(60 * 60_000), now)).toBe('1 hour ago')
    expect(relativeTime(ago(3 * 3_600_000), now)).toBe('3 hours ago')
    expect(relativeTime(ago(24 * 3_600_000), now)).toBe('yesterday')
    expect(relativeTime(ago(3 * 86_400_000), now)).toBe('3 days ago')
    expect(relativeTime(ago(8 * 86_400_000), now)).toBe('1 week ago')
    expect(relativeTime(ago(21 * 86_400_000), now)).toBe('3 weeks ago')
    expect(relativeTime(ago(40 * 86_400_000), now)).toBe('1 month ago')
    expect(relativeTime(ago(95 * 86_400_000), now)).toBe('3 months ago')
    expect(relativeTime(ago(400 * 86_400_000), now)).toBe('1 year ago')
    expect(relativeTime(ago(800 * 86_400_000), now)).toBe('2 years ago')
  })
  it('treats future and invalid dates as just now', () => {
    expect(relativeTime('2027-01-01T00:00:00.000Z', now)).toBe('just now')
    expect(relativeTime('not a date', now)).toBe('just now')
  })
})

describe('formatBytes / formatDuration', () => {
  it('formats sizes decimally like Finder', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(12_300)).toBe('12.3 KB')
    expect(formatBytes(2_400_000)).toBe('2.4 MB')
    expect(formatBytes(150_000_000)).toBe('150 MB')
    expect(formatBytes(3_000_000_000)).toBe('3 GB')
    expect(formatBytes(-1)).toBe('0 B')
  })
  it('formats durations as m:ss or h:mm:ss', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(65_000)).toBe('1:05')
    expect(formatDuration(3_725_000)).toBe('1:02:05')
    expect(formatDuration(Number.NaN)).toBe('0:00')
  })
})

describe('isProbablyNaturalLanguage', () => {
  it('detects questions and long queries', () => {
    expect(isProbablyNaturalLanguage('minimax')).toBe(false)
    expect(isProbablyNaturalLanguage('hyperliquid docs')).toBe(false)
    expect(isProbablyNaturalLanguage('github repo')).toBe(false)
    expect(isProbablyNaturalLanguage('what am I researching here?')).toBe(true)
    expect(isProbablyNaturalLanguage('find that mac app')).toBe(true)
    expect(isProbablyNaturalLanguage('the website with the globe animation')).toBe(true)
    expect(isProbablyNaturalLanguage('minimax?')).toBe(true)
    expect(isProbablyNaturalLanguage('   ')).toBe(false)
  })
})

describe('tokenize', () => {
  it('splits on non-alphanumerics, lowercases and keeps unicode', () => {
    expect(tokenize('Hello, World! 42')).toEqual(['hello', 'world', '42'])
    expect(tokenize('Résumé_naïve — 文件')).toEqual(['résumé', 'naïve', '文件'])
    expect(tokenize('')).toEqual([])
  })
})
