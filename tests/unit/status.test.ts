import { describe, expect, it } from 'vitest'
import {
  isFailed,
  isProcessingStatus,
  isTerminal,
  next,
  PROCESSING_STATUSES,
  type ProcessingStatus,
  STAGE_LABEL,
  STATUS_LABEL,
  STICKY_STATUSES,
  type StageOutcome,
  stageEntryStatus,
  USER_STAGES,
  userStageFor
} from '../../src/shared/status'
import type { Stage } from '../../src/shared/types'

const STAGES: readonly Stage[] = [
  'extract',
  'thumbnail',
  'snapshot',
  'embed',
  'index',
  'understand',
  'relate',
  'organize_batch',
  'consolidate'
]
const OUTCOMES: readonly StageOutcome[] = ['ok', 'partial', 'failed']
const BEFORE_UNDERSTANDING: readonly ProcessingStatus[] = ['CAPTURED', 'EXTRACTING', 'EXTRACTED', 'EMBEDDING']

describe('status vocabulary', () => {
  it('lists every status once', () => {
    expect(new Set(PROCESSING_STATUSES).size).toBe(PROCESSING_STATUSES.length)
    expect(isProcessingStatus('READY')).toBe(true)
    expect(isProcessingStatus('ready')).toBe(false)
  })

  it('classifies failed and terminal statuses', () => {
    for (const status of PROCESSING_STATUSES) {
      expect(isFailed(status)).toBe(status === 'EXTRACTION_FAILED' || status === 'AI_FAILED')
      expect(isTerminal(status)).toBe(status === 'READY' || status === 'PARTIAL')
    }
  })

  it('maps flow statuses to user stages and nothing else', () => {
    expect(USER_STAGES.map((s) => s.id)).toEqual(['reading', 'understanding', 'connecting'])
    expect(userStageFor('EXTRACTING')?.id).toBe('reading')
    expect(userStageFor('EXTRACTED')?.id).toBe('reading')
    expect(userStageFor('EMBEDDING')?.id).toBe('reading')
    expect(userStageFor('UNDERSTANDING')?.id).toBe('understanding')
    expect(userStageFor('RELATING')?.id).toBe('connecting')
    for (const status of [
      'CAPTURED',
      'READY',
      'PARTIAL',
      'EXTRACTION_FAILED',
      'AI_FAILED',
      'WAITING_FOR_AI'
    ] as const) {
      expect(userStageFor(status)).toBeNull()
    }
  })

  it('has copy for every status and stage', () => {
    for (const status of PROCESSING_STATUSES) expect(typeof STATUS_LABEL[status]).toBe('string')
    for (const stage of STAGES) expect(STAGE_LABEL[stage].length).toBeGreaterThan(0)
    expect(STATUS_LABEL.CAPTURED).toBe('Saved.')
    expect(STATUS_LABEL.READY).toBe('')
    expect(STATUS_LABEL.PARTIAL).toBe('Kept. Partly understood.')
    expect(STATUS_LABEL.EXTRACTION_FAILED).toBe("Couldn't read this, but it's kept.")
    expect(STATUS_LABEL.AI_FAILED).toBe('Still figuring this one out.')
    expect(STATUS_LABEL.WAITING_FOR_AI).toBe('Kept. Not understood yet.')
  })
})

describe('next(): full transition table', () => {
  it('extract: ok/partial → EXTRACTED, failed → EXTRACTION_FAILED from every status', () => {
    for (const status of PROCESSING_STATUSES) {
      expect(next(status, 'extract', 'ok')).toBe('EXTRACTED')
      expect(next(status, 'extract', 'partial')).toBe('EXTRACTED')
      expect(next(status, 'extract', 'failed')).toBe('EXTRACTION_FAILED')
    }
  })

  it('thumbnail/snapshot/index: never change the status unless they are the last stage', () => {
    for (const stage of ['thumbnail', 'snapshot', 'index'] as const) {
      for (const status of PROCESSING_STATUSES) {
        for (const outcome of OUTCOMES) {
          expect(next(status, stage, outcome)).toBe(status)
          expect(next(status, stage, outcome, { isLast: false })).toBe(status)
        }
      }
    }
  })

  it('thumbnail/snapshot/index as the last stage settle the item', () => {
    for (const stage of ['thumbnail', 'snapshot', 'index'] as const) {
      for (const status of PROCESSING_STATUSES) {
        const sticky = STICKY_STATUSES.includes(status)
        expect(next(status, stage, 'ok', { isLast: true })).toBe(sticky ? 'PARTIAL' : 'READY')
        expect(next(status, stage, 'partial', { isLast: true })).toBe('PARTIAL')
        expect(next(status, stage, 'failed', { isLast: true })).toBe('PARTIAL')
      }
    }
  })

  it('embed: moves pre-understanding statuses to UNDERSTANDING, leaves everything else alone', () => {
    for (const status of PROCESSING_STATUSES) {
      const expected = BEFORE_UNDERSTANDING.includes(status) ? 'UNDERSTANDING' : status
      expect(next(status, 'embed', 'ok')).toBe(expected)
      expect(next(status, 'embed', 'partial')).toBe(expected)
      expect(next(status, 'embed', 'failed')).toBe(status)
    }
  })

  it('understand: ok → RELATING (PARTIAL from EXTRACTION_FAILED), partial → PARTIAL, failed → AI_FAILED', () => {
    for (const status of PROCESSING_STATUSES) {
      expect(next(status, 'understand', 'ok')).toBe(status === 'EXTRACTION_FAILED' ? 'PARTIAL' : 'RELATING')
      expect(next(status, 'understand', 'partial')).toBe('PARTIAL')
      expect(next(status, 'understand', 'failed')).toBe('AI_FAILED')
    }
  })

  it('relate/organize_batch: ok → READY (PARTIAL from sticky), partial → PARTIAL, failed → AI_FAILED', () => {
    for (const stage of ['relate', 'organize_batch'] as const) {
      for (const status of PROCESSING_STATUSES) {
        const sticky = STICKY_STATUSES.includes(status)
        expect(next(status, stage, 'ok')).toBe(sticky ? 'PARTIAL' : 'READY')
        expect(next(status, stage, 'partial')).toBe('PARTIAL')
        expect(next(status, stage, 'failed')).toBe('AI_FAILED')
      }
    }
  })

  it('consolidate: batch-level, never changes an item status', () => {
    for (const status of PROCESSING_STATUSES) {
      for (const outcome of OUTCOMES) expect(next(status, 'consolidate', outcome)).toBe(status)
    }
  })

  it('always returns a known status for every combination', () => {
    for (const status of PROCESSING_STATUSES) {
      for (const stage of STAGES) {
        for (const outcome of OUTCOMES) {
          expect(PROCESSING_STATUSES).toContain(next(status, stage, outcome))
          expect(PROCESSING_STATUSES).toContain(next(status, stage, outcome, { isLast: true }))
        }
      }
    }
  })
})

describe('next(): end-to-end flows', () => {
  /** Simulates the scheduler: apply entry status (if any), then the transition. */
  const run = (status: ProcessingStatus, stage: Stage, outcome: StageOutcome, isLast = false): ProcessingStatus =>
    next(stageEntryStatus(stage, status) ?? status, stage, outcome, { isLast })

  it('url: extract + snapshot → embed + understand → index → relate → READY', () => {
    let s: ProcessingStatus = 'CAPTURED'
    s = run(s, 'extract', 'ok')
    expect(s).toBe('EXTRACTED')
    s = run(s, 'snapshot', 'ok')
    expect(s).toBe('EXTRACTED')
    s = run(s, 'embed', 'ok')
    expect(s).toBe('UNDERSTANDING')
    s = run(s, 'understand', 'ok')
    expect(s).toBe('RELATING')
    s = run(s, 'index', 'ok')
    expect(s).toBe('RELATING')
    s = run(s, 'relate', 'ok')
    expect(s).toBe('READY')
  })

  it('understand may finish before embed without regressing the status', () => {
    let s: ProcessingStatus = 'EXTRACTED'
    s = run(s, 'understand', 'ok')
    expect(s).toBe('RELATING')
    s = run(s, 'embed', 'ok')
    expect(s).toBe('RELATING')
  })

  it('extraction failure still proceeds to understanding on metadata and ends PARTIAL', () => {
    let s: ProcessingStatus = 'CAPTURED'
    s = run(s, 'extract', 'failed')
    expect(s).toBe('EXTRACTION_FAILED')
    s = run(s, 'embed', 'ok')
    expect(s).toBe('EXTRACTION_FAILED')
    expect(stageEntryStatus('understand', s)).toBeNull()
    s = run(s, 'understand', 'ok')
    expect(s).toBe('PARTIAL')
    s = run(s, 'index', 'ok')
    expect(s).toBe('PARTIAL')
    expect(stageEntryStatus('relate', s)).toBeNull()
    s = run(s, 'relate', 'ok')
    expect(s).toBe('PARTIAL')
  })

  it('image: thumbnail → understand → index → relate', () => {
    let s: ProcessingStatus = 'CAPTURED'
    s = run(s, 'thumbnail', 'ok')
    expect(s).toBe('CAPTURED')
    s = run(s, 'understand', 'ok')
    expect(s).toBe('RELATING')
    s = run(s, 'index', 'ok')
    s = run(s, 'organize_batch', 'ok')
    expect(s).toBe('READY')
  })

  it('note: embed → index (last) → READY, no understanding', () => {
    let s: ProcessingStatus = 'CAPTURED'
    s = run(s, 'embed', 'ok')
    s = run(s, 'index', 'ok', true)
    expect(s).toBe('READY')
  })

  it('AI failure is retryable and WAITING_FOR_AI resumes cleanly', () => {
    expect(run('EXTRACTED', 'understand', 'failed')).toBe('AI_FAILED')
    expect(run('AI_FAILED', 'understand', 'ok')).toBe('RELATING')
    expect(run('WAITING_FOR_AI', 'understand', 'ok')).toBe('RELATING')
    expect(run('WAITING_FOR_AI', 'relate', 'ok')).toBe('READY')
    expect(run('WAITING_FOR_AI', 'embed', 'ok')).toBe('WAITING_FOR_AI')
  })

  it('re-indexing a settled item after a user edit leaves it settled', () => {
    expect(run('READY', 'index', 'ok')).toBe('READY')
    expect(run('PARTIAL', 'index', 'ok')).toBe('PARTIAL')
  })
})

describe('stageEntryStatus()', () => {
  it('returns the running status per stage', () => {
    expect(stageEntryStatus('extract')).toBe('EXTRACTING')
    expect(stageEntryStatus('embed')).toBe('EMBEDDING')
    expect(stageEntryStatus('understand')).toBe('UNDERSTANDING')
    expect(stageEntryStatus('relate')).toBe('RELATING')
    expect(stageEntryStatus('organize_batch')).toBe('RELATING')
    for (const stage of ['thumbnail', 'snapshot', 'index', 'consolidate'] as const) {
      expect(stageEntryStatus(stage)).toBeNull()
    }
  })

  it('does not overwrite sticky statuses except for extract', () => {
    for (const sticky of STICKY_STATUSES) {
      expect(stageEntryStatus('extract', sticky)).toBe('EXTRACTING')
      for (const stage of ['embed', 'understand', 'relate', 'organize_batch'] as const) {
        expect(stageEntryStatus(stage, sticky)).toBeNull()
      }
    }
    expect(stageEntryStatus('understand', 'AI_FAILED')).toBe('UNDERSTANDING')
    expect(stageEntryStatus('understand', 'WAITING_FOR_AI')).toBe('UNDERSTANDING')
    expect(stageEntryStatus('relate', 'AI_FAILED')).toBe('RELATING')
    expect(stageEntryStatus('relate', 'WAITING_FOR_AI')).toBe('RELATING')
  })

  it('never moves an item backwards', () => {
    expect(stageEntryStatus('embed', 'RELATING')).toBeNull()
    expect(stageEntryStatus('embed', 'UNDERSTANDING')).toBeNull()
    expect(stageEntryStatus('embed', 'AI_FAILED')).toBeNull()
    expect(stageEntryStatus('embed', 'WAITING_FOR_AI')).toBeNull()
    expect(stageEntryStatus('embed', 'READY')).toBeNull()
    expect(stageEntryStatus('embed', 'EXTRACTED')).toBe('EMBEDDING')
    expect(stageEntryStatus('embed', 'CAPTURED')).toBe('EMBEDDING')
    expect(stageEntryStatus('understand', 'RELATING')).toBeNull()
    expect(stageEntryStatus('understand', 'EMBEDDING')).toBe('UNDERSTANDING')
    expect(stageEntryStatus('relate', 'READY')).toBeNull()
    expect(stageEntryStatus('relate', 'UNDERSTANDING')).toBe('RELATING')
    expect(stageEntryStatus('extract', 'READY')).toBe('EXTRACTING')
  })
})
