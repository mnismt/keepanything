import { describe, expect, it } from 'vitest'
import { COPY, LIMITS } from '../../src/shared/constants'
import {
  isSymmetric,
  KIND_LABEL,
  KINDS,
  normalizePair,
  RELATIONSHIP_TYPE_IDS,
  RELATIONSHIP_TYPES,
  relationshipLabel,
  relationshipSuppressionKey
} from '../../src/shared/kinds'

describe('KINDS and RELATIONSHIP_TYPES', () => {
  it('labels every kind', () => {
    expect(KINDS).toHaveLength(16)
    for (const kind of KINDS) expect(KIND_LABEL[kind].length).toBeGreaterThan(0)
  })

  it('declares symmetry and labels for every relationship type', () => {
    expect(RELATIONSHIP_TYPE_IDS).toHaveLength(10)
    const symmetric = RELATIONSHIP_TYPE_IDS.filter((t) => isSymmetric(t)).sort()
    expect(symmetric).toEqual(['alternative_to', 'contradicts', 'duplicate_of', 'related_to', 'same_project'])
    for (const t of symmetric) expect(RELATIONSHIP_TYPES[t].label).toBe(RELATIONSHIP_TYPES[t].inverseLabel)
    expect(relationshipLabel('inspired_by', 'out')).toBe('inspired by')
    expect(relationshipLabel('inspired_by', 'in')).toBe('inspired')
    expect(relationshipLabel('created_from', 'in')).toBe('source of')
    expect(relationshipLabel('belongs_to', 'in')).toBe('contains')
  })

  it('normalizes symmetric pairs and keeps directed ones', () => {
    expect(normalizePair('b', 'a', 'related_to')).toEqual(['a', 'b'])
    expect(normalizePair('a', 'b', 'related_to')).toEqual(['a', 'b'])
    expect(normalizePair('b', 'a', 'inspired_by')).toEqual(['b', 'a'])
    expect(relationshipSuppressionKey('b', 'a')).toBe('a:b')
  })
})

describe('constants', () => {
  it('keeps the lane and copy contract', () => {
    expect(LIMITS.lanes).toEqual({ io: 2, embed: 1, ai: 1 })
    expect(LIMITS.retryBackoffMs).toEqual([30_000, 120_000, 600_000])
    expect(COPY.foundRelated(4)).toBe('Linked to 4 things.')
    expect(COPY.foundRelated(1)).toBe('Linked to 1 thing.')
    expect(COPY.alreadyKept('3 weeks ago')).toBe('Already kept · 3 weeks ago')
    expect(COPY.noMatches('x')).toBe('Nothing matches "x".')
  })
})
