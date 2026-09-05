import { describe, expect, it } from 'vitest'
import {
  evidenceHeader,
  formatElapsed,
  groupHits,
  hitSnippet,
  noteBodyFor,
  noteTitleFor,
  shouldOfferAsk,
  toolLabel
} from '../../src/renderer/src/lib/palette'
import type { AgentStep, SearchHit } from '../../src/shared/types'

function hit(id: string, type: SearchHit['type'], extra: Partial<SearchHit> = {}): SearchHit {
  return {
    id,
    title: id,
    type,
    subtype: null,
    kind: null,
    domain: null,
    capturedAt: '2026-01-01T00:00:00.000Z',
    capturedAgo: 'just now',
    understanding: null,
    evidence: { matchedFields: [] },
    score: 1,
    ...extra
  }
}

describe('groupHits', () => {
  it('groups by type, keeps rank order inside a group and orders groups by their best hit', () => {
    const groups = groupHits([
      hit('a', 'pdf'),
      hit('b', 'url'),
      hit('c', 'markdown'),
      hit('d', 'image'),
      hit('e', 'url')
    ])
    expect(groups.map((g) => g.id)).toEqual(['documents', 'links', 'images'])
    expect(groups[0]?.hits.map((h) => h.id)).toEqual(['a', 'c'])
    expect(groups[1]?.hits.map((h) => h.id)).toEqual(['b', 'e'])
    expect(groups[0]?.label).toBe('Documents')
  })

  it('drops empty groups and maps every type', () => {
    expect(groupHits([])).toEqual([])
    const ids = groupHits([
      hit('n', 'note'),
      hit('f', 'file'),
      hit('v', 'video'),
      hit('u', 'unknown'),
      hit('fo', 'folder')
    ]).map((g) => g.id)
    expect(ids).toEqual(['notes', 'files', 'images'])
  })
})

describe('hitSnippet / shouldOfferAsk', () => {
  it('prefers the FTS snippet, then understanding, then domain', () => {
    expect(hitSnippet({ snippet: ' batching ', understanding: 'x', domain: 'y' })).toBe('batching')
    expect(hitSnippet({ understanding: 'An article', domain: 'y' })).toBe('An article')
    expect(hitSnippet({ domain: 'anyscale.com' })).toBe('anyscale.com')
    expect(hitSnippet({ domain: null })).toBe('')
  })

  it('offers Ask for natural language or when nothing matched', () => {
    expect(shouldOfferAsk('', 0)).toBe(false)
    expect(shouldOfferAsk('minimax', 3)).toBe(false)
    expect(shouldOfferAsk('minimax', 0)).toBe(true)
    expect(shouldOfferAsk('what did I save about inference', 5)).toBe(true)
    expect(shouldOfferAsk('globe animation?', 2)).toBe(true)
  })
})

describe('toolLabel / formatElapsed', () => {
  it('maps tool ids to short verbs and falls back gracefully', () => {
    expect(toolLabel('search_library')).toBe('Searched')
    expect(toolLabel('read_document')).toBe('Read')
    expect(toolLabel('create_note')).toBe('Wrote')
    expect(toolLabel('finish')).toBe('Answered')
    expect(toolLabel('some_new_tool')).toBe('Some new tool')
  })

  it('formats elapsed time compactly', () => {
    expect(formatElapsed(420)).toBe('0.4s')
    expect(formatElapsed(1000)).toBe('1s')
    expect(formatElapsed(12_400)).toBe('12s')
    expect(formatElapsed(65_000)).toBe('1m 05s')
    expect(formatElapsed(-1)).toBe('0s')
  })
})

describe('evidenceHeader', () => {
  const step = (
    n: number,
    kind: AgentStep['kind'],
    itemIds: string[],
    status: AgentStep['status'] = 'ok'
  ): AgentStep => ({
    n,
    tool: 't',
    kind,
    label: '',
    itemIds,
    status,
    durationMs: 1
  })

  it('counts distinct looked-at and read items from structured steps only', () => {
    const header = evidenceHeader(
      [
        step(1, 'search', ['a', 'b', 'c']),
        step(2, 'read', ['a', 'd']),
        step(3, 'read', ['a'], 'rejected'),
        step(4, 'write', [])
      ],
      { topics: ['inference', 'cost', 'gpu', 'extra'], types: [], timeframe: { label: 'Last month' } }
    )
    expect(header).toBe('Looked at 4 items · Read 2 · 1 change · Theme: inference, cost, gpu · Last month')
  })

  it('is empty when nothing is known', () => {
    expect(evidenceHeader([])).toBe('')
    expect(evidenceHeader([step(1, 'read', ['x'])])).toBe('Looked at 1 item · Read 1')
  })
})

describe('note helpers', () => {
  it('derives a note title and body from the question and answer', () => {
    expect(noteTitleFor('  What am I  researching here?? ')).toBe('What am I researching here')
    expect(noteTitleFor('')).toBe('Answer')
    expect(noteTitleFor('x'.repeat(100))).toHaveLength(72)
    const body = noteBodyFor('Why?', ' Because. ', [{ title: 'A' }, { title: 'B' }])
    expect(body).toBe('# Why\n\nBecause.\n\n## Sources\n\n- A\n- B')
    expect(noteBodyFor('Why?', 'Because.', [])).toBe('# Why\n\nBecause.')
  })
})
