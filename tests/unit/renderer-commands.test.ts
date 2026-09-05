import { describe, expect, it } from 'vitest'
import { runHeadline, runOutcome, runTitle } from '../../src/renderer/src/lib/activity'
import {
  buildAskAboutSelection,
  buildSelectionCommand,
  commandsFor,
  SELECTION_COMMANDS,
  templateFromMenuAction
} from '../../src/renderer/src/lib/commands'

describe('selection commands', () => {
  it('offers pairwise commands only for two or more items', () => {
    expect(commandsFor(1).map((c) => c.template)).toEqual(['summarize', 'brief'])
    expect(commandsFor(2).map((c) => c.template)).toEqual(['compare', 'common', 'summarize', 'brief'])
    expect(commandsFor(0)).toEqual([])
    expect(SELECTION_COMMANDS.every((c) => c.question.length > 0 && c.label.length > 0)).toBe(true)
  })

  it('builds agent:command payloads with deduplicated ids and the template question', () => {
    expect(buildSelectionCommand('compare', ['a', 'b', 'a'])).toEqual({
      question: 'Compare these',
      itemIds: ['a', 'b'],
      template: 'compare'
    })
    expect(buildSelectionCommand('custom', ['a'])).toEqual({
      question: 'Look at these',
      itemIds: ['a'],
      template: 'custom'
    })
  })

  it('builds a free-form question over the selection, or a plain question without one', () => {
    expect(buildAskAboutSelection(' which is cheaper? ', ['a', 'a', 'b'])).toEqual({
      question: 'which is cheaper?',
      itemIds: ['a', 'b'],
      template: 'custom'
    })
    expect(buildAskAboutSelection('what did I save', [])).toEqual({ question: 'what did I save' })
  })

  it('maps native menu action ids to templates', () => {
    expect(templateFromMenuAction('compare')).toBe('compare')
    expect(templateFromMenuAction('brief')).toBe('brief')
    expect(templateFromMenuAction('trash')).toBeNull()
  })
})

describe('run descriptions', () => {
  it('titles runs by task and tense', () => {
    expect(runTitle({ task: 'command', status: 'running' })).toBe('Looking through your library')
    expect(runTitle({ task: 'command', status: 'succeeded' })).toBe('Answered')
    expect(runTitle({ task: 'organize_batch', status: 'succeeded' })).toBe('Organized')
    expect(runHeadline({ task: 'understand', status: 'running' }, 'Read the page')).toBe(
      'Understanding · Read the page'
    )
  })

  it('summarises outcomes from structured results only', () => {
    expect(runOutcome({ task: 'organize', status: 'running' })).toBe('')
    expect(runOutcome({ task: 'organize', status: 'cancelled' })).toBe('Stopped.')
    expect(runOutcome({ task: 'organize', status: 'failed', error: { message: 'offline' } })).toBe(
      "Didn't finish: offline"
    )
    expect(
      runOutcome({
        task: 'organize',
        status: 'succeeded',
        result: { task: 'organize', itemId: 'i', relationshipIds: ['r1', 'r2'], collectionIds: ['c'], summary: 's' }
      })
    ).toBe('Found 2 related things · Added to 1 collection.')
    expect(
      runOutcome({
        task: 'organize',
        status: 'succeeded',
        result: { task: 'organize', itemId: 'i', relationshipIds: [], collectionIds: [], summary: '' }
      })
    ).toBe('Nothing to connect yet.')
    expect(
      runOutcome({
        task: 'command',
        status: 'succeeded',
        result: {
          task: 'command',
          kind: 'answer',
          answer: 'x',
          sources: [{ itemId: 'a', role: 'primary', why: '' }],
          cues: { topics: [], types: [] },
          confidence: 1
        }
      })
    ).toBe('Answered from 1 source.')
    expect(
      runOutcome({
        task: 'command',
        status: 'succeeded',
        result: {
          task: 'command',
          kind: 'note',
          noteId: 'n',
          sources: [],
          cues: { topics: [], types: [] },
          confidence: 1
        }
      })
    ).toBe('Wrote a note.')
  })
})
