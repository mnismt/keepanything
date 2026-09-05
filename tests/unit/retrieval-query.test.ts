import { describe, expect, it } from 'vitest'
import {
  buildBagMatch,
  buildMatch,
  matchesTypeCue,
  parseQuery,
  parseTimeCue,
  recencyBoost,
  timeBoost
} from '../../src/main/retrieval'

const NOW = new Date('2026-09-03T10:00:00.000Z')
const DAY = 86_400_000

describe('parseQuery', () => {
  it.each([
    ['vllm', { tokens: ['vllm'], types: [] }],
    ['that pdf about attention', { tokens: ['attention'], types: ['pdf'] }],
    ['karpathy video about llms', { tokens: ['karpathy', 'llms'], types: ['video', 'url'], subtypes: ['youtube'] }],
    [
      'github repo for running transformers in javascript',
      { tokens: ['running', 'transformers', 'javascript'], subtypes: ['github_repo'] }
    ],
    ['screenshot of inference pricing', { tokens: ['inference', 'pricing'], subtypes: ['screenshot'] }],
    ['the benchmark folder with the csv results', { tokens: ['benchmark', 'csv', 'results'], types: ['folder'] }],
    ['what did I save about cheaper Resend alternatives?', { tokens: ['cheaper', 'resend', 'alternatives'], types: [] }]
  ])('understands %j', (query, expected) => {
    const parsed = parseQuery(query, NOW)
    expect(parsed.tokens).toEqual(expected.tokens)
    if ('types' in expected) expect(parsed.cues.types).toEqual(expected.types)
    if ('subtypes' in expected) expect(parsed.cues.subtypes).toEqual(expected.subtypes)
  })

  it('turns "mac app" into the macOS-app kind and "app" alone into the wider set', () => {
    expect(parseQuery('that mac app I saved a few weeks ago', NOW).cues.kinds).toEqual(['macos_app'])
    expect(parseQuery('an app for tiling windows', NOW).cues.kinds).toEqual(['macos_app', 'cli_tool', 'saas_product'])
  })

  it('extracts time cues as soft windows', () => {
    const weeks = parseQuery('that mac app I saved a few weeks ago', NOW)
    expect(weeks.cues.timeframe?.label).toBe('a few weeks ago')
    expect(weeks.cues.timeframe?.since).toBe(new Date(NOW.getTime() - 35 * DAY).toISOString())
    expect(weeks.cues.timeframe?.until).toBe(new Date(NOW.getTime() - 10 * DAY).toISOString())
    expect(weeks.tokens).toEqual([])

    const notes = parseQuery('my notes from last week', NOW)
    expect(notes.cues.noteCue).toBe(true)
    expect(notes.cues.kinds).toEqual(['note'])
    expect(notes.cues.timeframe?.since).toBe(new Date(NOW.getTime() - 14 * DAY).toISOString())
    expect(notes.cues.timeframe?.until).toBeUndefined()

    expect(parseTimeCue('3 days ago', NOW)?.until).toBe(new Date(NOW.getTime() - 1 * DAY).toISOString())
    expect(parseTimeCue('nothing here', NOW)).toBeNull()
  })

  it('keeps quoted phrases and understands the type:/since: grammar', () => {
    const parsed = parseQuery('"globe animation" website type:url since:7d', NOW)
    expect(parsed.phrases).toEqual([['globe', 'animation']])
    expect(parsed.cues.types).toEqual(['url'])
    expect(parsed.cues.strict).toBe(true)
    expect(parsed.cues.timeframe?.since).toBe(new Date(NOW.getTime() - 7 * DAY).toISOString())
    expect(parsed.embedText).toContain('globe animation')
  })

  it('merges explicit filters into the cues', () => {
    const parsed = parseQuery('inference', NOW, { types: ['pdf'], since: '2026-08-01T00:00:00.000Z', strict: true })
    expect(parsed.cues.types).toEqual(['pdf'])
    expect(parsed.cues.strict).toBe(true)
    expect(parsed.cues.timeframe?.since).toBe('2026-08-01T00:00:00.000Z')
  })
})

describe('buildMatch', () => {
  it('quotes every token and ANDs them by default', () => {
    expect(buildMatch(parseQuery('cheap inference providers', NOW))).toBe('"cheap" AND "inference" AND "providers"')
  })

  it('adds a prefix to the last token and synonym groups', () => {
    expect(buildMatch(parseQuery('inference prov', NOW), { prefixLast: true })).toBe('"inference" AND "prov"*')
    expect(buildMatch(parseQuery('tiling app', NOW), { prefixLast: true })).toBe('"tiling"*')
    expect(buildMatch({ tokens: ['repo'], phrases: [], cueTokens: [] })).toBe('("repo" OR "repository")')
  })

  it('never forwards FTS operators from the raw text', () => {
    const parsed = parseQuery('foo) OR (bar NEAR baz* "unterminated', NOW)
    const match = buildMatch(parsed) ?? ''
    expect(match).not.toMatch(/[()*]/)
    expect(match.split(' AND ').every((group) => /^"[a-z0-9]+"$/.test(group))).toBe(true)
  })

  it('falls back to cue tokens when nothing else remains, and to null when empty', () => {
    expect(buildMatch(parseQuery('pdf', NOW))).toBe('"pdf"')
    expect(buildMatch(parseQuery('the of and', NOW))).toBeNull()
    expect(buildMatch(parseQuery('alpha beta', NOW), { mode: 'or' })).toBe('"alpha" OR "beta"')
  })

  it('builds OR bags for candidate retrieval', () => {
    expect(buildBagMatch(['vLLM engine', 'llm-serving', 'the'])).toBe('"vllm" OR "engine" OR "llm" OR "serving"')
    expect(buildBagMatch([])).toBeNull()
  })
})

describe('boosts', () => {
  it('plateaus inside the window and decays outside it', () => {
    const cue = {
      since: new Date(NOW.getTime() - 35 * DAY).toISOString(),
      until: new Date(NOW.getTime() - 10 * DAY).toISOString()
    }
    expect(timeBoost(new Date(NOW.getTime() - 20 * DAY).toISOString(), cue, NOW)).toBe(1.5)
    const justOutside = timeBoost(new Date(NOW.getTime() - 5 * DAY).toISOString(), cue, NOW)
    expect(justOutside).toBeGreaterThan(1)
    expect(justOutside).toBeLessThan(1.5)
    expect(timeBoost(new Date(NOW.getTime() - 200 * DAY).toISOString(), cue, NOW)).toBe(1)
  })

  it('applies a mild recency boost that fades with age', () => {
    expect(recencyBoost(NOW.toISOString(), NOW)).toBeCloseTo(1.25, 2)
    expect(recencyBoost(new Date(NOW.getTime() - 600 * DAY).toISOString(), NOW)).toBeCloseTo(1, 3)
  })

  it('matches type cues on type, subtype or kind', () => {
    const cues = parseQuery('karpathy video', NOW).cues
    expect(matchesTypeCue({ type: 'url', subtype: 'youtube', kind: null }, cues)).toBe(true)
    expect(matchesTypeCue({ type: 'pdf', subtype: null, kind: 'video' }, cues)).toBe(true)
    expect(matchesTypeCue({ type: 'pdf', subtype: null, kind: 'paper' }, cues)).toBe(false)
  })
})
