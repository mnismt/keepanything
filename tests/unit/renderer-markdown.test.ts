import { describe, expect, it } from 'vitest'
import { parseBlocks, parseInline } from '../../src/renderer/src/lib/markdown-lite'

describe('parseInline', () => {
  it('wraps **text** in a strong span', () => {
    const spans = parseInline('a **b** c')
    expect(spans).toEqual([{ text: 'a ' }, { text: 'b', strong: true }, { text: ' c' }])
  })

  it('renders [label](url) as the label only', () => {
    const spans = parseInline('see `x` and [label](http://e.com)')
    expect(spans).toEqual([{ text: 'see ' }, { text: 'x', code: true }, { text: ' and ' }, { text: 'label' }])
  })

  it('leaves underscores inside identifiers alone', () => {
    expect(parseInline('open file_name_here now')).toEqual([{ text: 'open file_name_here now' }])
  })

  it('separates a citation marker from the word it is flush against', () => {
    expect(parseInline('**Title**[1] rest')).toEqual([{ text: 'Title', strong: true }, { text: ' [1] rest' }])
  })

  it('handles __strong__, _em_, and *em* variants', () => {
    const spans = parseInline('__one__ _two_ *three*')
    expect(spans).toEqual([
      { text: 'one', strong: true },
      { text: ' ' },
      { text: 'two', em: true },
      { text: ' ' },
      { text: 'three', em: true }
    ])
  })
})

describe('parseBlocks', () => {
  it('returns a paragraph then a list when a lead-in line is followed by indented sub-items', () => {
    const source = 'Key points to keep in mind:\n\n- top level\n  - nested one\n  - nested two\n- again top'
    const blocks = parseBlocks(source)
    expect(blocks).toHaveLength(2)
    const [first, second] = blocks
    expect(first?.kind).toBe('p')
    if (first?.kind !== 'p') return
    expect(first.spans.map((s) => s.text).join('')).toBe('Key points to keep in mind:')
    expect(second?.kind).toBe('list')
    if (second?.kind !== 'list') return
    expect(second.ordered).toBe(false)
    expect(second.items.map((i) => ({ text: i.spans.map((s) => s.text).join(''), nested: i.nested }))).toEqual([
      { text: 'top level', nested: false },
      { text: 'nested one', nested: true },
      { text: 'nested two', nested: true },
      { text: 'again top', nested: false }
    ])
  })

  it('does not collapse mixed paragraph + list blocks into one run-on paragraph', () => {
    const source = 'Lead in\n\n- first\n  - sub\n- second'
    const blocks = parseBlocks(source)
    expect(blocks.map((b) => b.kind)).toEqual(['p', 'list'])
    expect(
      blocks.some(
        (b) =>
          b.kind === 'p' &&
          b.spans
            .map((s) => s.text)
            .join('')
            .includes('- first')
      )
    ).toBe(false)
  })

  it('splits a lead-in line from its list when no blank line separates them', () => {
    const blocks = parseBlocks('Lead in\n- first\n- second')
    expect(blocks.map((b) => b.kind)).toEqual(['p', 'list'])
    const [first, second] = blocks
    if (first?.kind !== 'p' || second?.kind !== 'list') return
    expect(first.spans.map((s) => s.text).join('')).toBe('Lead in')
    expect(second.items.map((i) => i.spans.map((s) => s.text).join(''))).toEqual(['first', 'second'])
  })

  it('starts a heading that follows a paragraph line directly', () => {
    const blocks = parseBlocks('body text\n## Sources')
    expect(blocks.map((b) => b.kind)).toEqual(['p', 'h2'])
    const second = blocks[1]
    if (second?.kind !== 'h2') return
    expect(second.spans.map((s) => s.text).join('')).toBe('Sources')
  })

  it('returns a single ordered list for 1./2. lines', () => {
    const blocks = parseBlocks('1. one\n2. two')
    expect(blocks).toHaveLength(1)
    const only = blocks[0]
    expect(only?.kind).toBe('list')
    if (only?.kind !== 'list') return
    expect(only.ordered).toBe(true)
    expect(only.items.map((i) => i.spans.map((s) => s.text).join(''))).toEqual(['one', 'two'])
  })

  it('treats single # as h1 and ## as h2', () => {
    const blocks = parseBlocks('# Title\n\nbody\n\n## Sub')
    expect(blocks.map((b) => b.kind)).toEqual(['h1', 'p', 'h2'])
  })

  it('passes citation markers like [1] through as text', () => {
    const blocks = parseBlocks('Claim one [1] and another [2].')
    expect(blocks).toHaveLength(1)
    const only = blocks[0]
    expect(only?.kind).toBe('p')
    if (only?.kind !== 'p') return
    expect(only.spans.map((s) => s.text).join('')).toBe('Claim one [1] and another [2].')
  })
})
