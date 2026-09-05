import { describe, expect, it } from 'vitest'
import { type DragMeta, dragPeekLabel, peekDrag } from '../../src/renderer/src/lib/drag-peek'
import { INTERNAL_DND_MIME } from '../../src/shared/constants'

const dt = (types: string[], items: Array<{ kind: string; type: string }> = []): DragMeta => ({ types, items })

describe('peekDrag', () => {
  it('reads links and text from the type list when there are no files', () => {
    expect(peekDrag(dt(['text/uri-list', 'text/plain']))).toMatchObject({ kind: 'link', count: 1 })
    expect(peekDrag(dt(['text/plain']))).toMatchObject({ kind: 'text', count: 1 })
  })

  it('classifies files by MIME and collapses mixed sets', () => {
    expect(peekDrag(dt(['Files'], [{ kind: 'file', type: 'application/pdf' }]))).toEqual({
      kind: 'pdf',
      count: 1,
      parts: [{ kind: 'pdf', count: 1 }]
    })
    expect(
      peekDrag(
        dt(
          ['Files'],
          [
            { kind: 'file', type: 'image/png' },
            { kind: 'file', type: 'image/jpeg' }
          ]
        )
      )
    ).toMatchObject({ kind: 'image', count: 2 })
    expect(
      peekDrag(
        dt(
          ['Files'],
          [
            { kind: 'file', type: 'image/png' },
            { kind: 'file', type: 'application/pdf' }
          ]
        )
      )
    ).toEqual({
      kind: 'mixed',
      count: 2,
      parts: [
        { kind: 'image', count: 1 },
        { kind: 'pdf', count: 1 }
      ]
    })
    expect(peekDrag(dt(['Files'], [{ kind: 'file', type: '' }]))).toMatchObject({ kind: 'file', count: 1 })
  })

  it('ignores internal drags and empty transfers', () => {
    expect(peekDrag(dt([INTERNAL_DND_MIME]))).toBeNull()
    expect(peekDrag(dt([]))).toBeNull()
    expect(peekDrag(null)).toBeNull()
  })
})

describe('dragPeekLabel', () => {
  const one = (kind: 'pdf' | 'image') => ({ kind, count: 1 })
  it('pluralises with the count', () => {
    expect(dragPeekLabel({ kind: 'pdf', count: 1, parts: [one('pdf')] })).toBe('PDF')
    expect(dragPeekLabel({ kind: 'image', count: 3, parts: [{ kind: 'image', count: 3 }] })).toBe('3 images')
  })

  it('spells out a pair of different things, and counts from three up', () => {
    expect(dragPeekLabel({ kind: 'mixed', count: 2, parts: [{ kind: 'link', count: 1 }, one('pdf')] })).toBe(
      '1 link + 1 PDF'
    )
    expect(dragPeekLabel({ kind: 'mixed', count: 3, parts: [{ kind: 'image', count: 2 }, one('pdf')] })).toBe('3 items')
  })
})
