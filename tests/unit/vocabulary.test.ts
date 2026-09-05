import { describe, expect, it } from 'vitest'
import { actionsForItem, ITEM_ACTIONS, isActionId, MAX_DEFAULT_ACTIONS } from '../../src/shared/actions'
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

describe('ITEM_ACTIONS', () => {
  it('has unique ids and a valid guard', () => {
    const ids = ITEM_ACTIONS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(isActionId(id)).toBe(true)
    expect(isActionId('delete_everything')).toBe(false)
  })

  it('offers repo actions for GitHub repositories', () => {
    const ids = actionsForItem({ type: 'url', subtype: 'github_repo', kind: 'library' }).map((a) => a.id)
    expect(ids).toEqual(['explain_architecture', 'compare_with_saved_repos', 'extract_ideas', 'read_readme'])
  })

  it('offers reading actions for articles, papers, PDFs, markdown and text', () => {
    const reading = ['summarize_argument', 'extract_claims', 'compare_with_related', 'add_to_research_brief']
    expect(actionsForItem({ type: 'url', subtype: 'article', kind: null }).map((a) => a.id)).toEqual(reading)
    expect(actionsForItem({ type: 'url', subtype: 'paper', kind: 'paper' }).map((a) => a.id)).toEqual(reading)
    expect(actionsForItem({ type: 'pdf', subtype: null, kind: null }).map((a) => a.id)).toEqual(reading)
    expect(actionsForItem({ type: 'markdown', subtype: null, kind: null }).map((a) => a.id)).toEqual(reading)
    expect(actionsForItem({ type: 'text', subtype: null, kind: null }).map((a) => a.id)).toEqual(reading)
  })

  it('falls back to generic page actions for other URLs', () => {
    expect(actionsForItem({ type: 'url', subtype: 'generic', kind: null }).map((a) => a.id)).toEqual([
      'summarize_page',
      'extract_key_points'
    ])
    expect(actionsForItem({ type: 'url', subtype: null, kind: 'saas_product' }).map((a) => a.id)).toEqual([
      'summarize_page',
      'extract_key_points'
    ])
  })

  it('offers visual actions for images and Figma links, receipts first when the kind says so', () => {
    const visual = ['describe_visual_language', 'find_similar_references', 'extract_design_ideas']
    expect(actionsForItem({ type: 'image', subtype: 'screenshot', kind: 'screenshot' }).map((a) => a.id)).toEqual(
      visual
    )
    expect(actionsForItem({ type: 'image', subtype: null, kind: null }).map((a) => a.id)).toEqual(visual)
    expect(actionsForItem({ type: 'url', subtype: 'figma', kind: 'design_reference' }).map((a) => a.id)).toEqual(visual)
    expect(actionsForItem({ type: 'image', subtype: 'photo', kind: 'receipt' }).map((a) => a.id)).toEqual([
      'extract_transaction',
      'find_related_purchases',
      'describe_visual_language',
      'find_similar_references'
    ])
    expect(actionsForItem({ type: 'pdf', subtype: null, kind: 'receipt' }).map((a) => a.id)).toEqual([
      'extract_transaction',
      'find_related_purchases',
      'summarize_argument',
      'extract_claims'
    ])
  })

  it('offers folder actions and never more than the cap', () => {
    expect(actionsForItem({ type: 'folder', subtype: null, kind: null }).map((a) => a.id)).toEqual([
      'describe_folder',
      'list_key_files'
    ])
    expect(actionsForItem({ type: 'note', subtype: null, kind: 'note' })).toEqual([])
    for (const type of ['url', 'image', 'pdf', 'folder', 'file', 'video'] as const) {
      expect(actionsForItem({ type, subtype: null, kind: 'receipt' }).length).toBeLessThanOrEqual(MAX_DEFAULT_ACTIONS)
    }
  })
})

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
    expect(COPY.foundRelated(4)).toBe('Found 4 related things.')
    expect(COPY.foundRelated(1)).toBe('Found 1 related thing.')
    expect(COPY.alreadyKept('3 weeks ago')).toBe('Already kept · 3 weeks ago')
    expect(COPY.noMatches('x')).toBe('Nothing matches "x".')
  })
})
