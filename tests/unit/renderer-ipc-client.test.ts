import { describe, expect, it } from 'vitest'
import { describeError, failure, success, unwrapEnvelope } from '../../src/renderer/src/lib/envelope'

describe('envelope unwrapping', () => {
  it('passes ok envelopes through with their data', () => {
    expect(unwrapEnvelope<number[]>({ ok: true, data: [1, 2] })).toEqual({ ok: true, data: [1, 2] })
    expect(unwrapEnvelope<void>({ ok: true, data: undefined })).toEqual({ ok: true, data: undefined })
  })

  it('passes well-formed error envelopes through', () => {
    const r = unwrapEnvelope({ ok: false, error: { code: 'NOT_FOUND', message: 'gone' } })
    expect(r).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'gone' } })
  })

  it('turns malformed responses into INTERNAL failures instead of throwing', () => {
    for (const bad of [
      null,
      undefined,
      42,
      'nope',
      {},
      { ok: 'yes' },
      { ok: false },
      { ok: false, error: { code: 1 } }
    ]) {
      const r = unwrapEnvelope(bad)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error.code).toBe('INTERNAL')
    }
  })

  it('helpers build results', () => {
    expect(success(1)).toEqual({ ok: true, data: 1 })
    expect(failure('VALIDATION', 'x')).toEqual({ ok: false, error: { code: 'VALIDATION', message: 'x' } })
  })

  it('describes errors in product voice', () => {
    expect(describeError({ code: 'AI_NOT_CONFIGURED', message: '' })).toBe(
      'Connect an AI provider in Settings to do this.'
    )
    expect(describeError({ code: 'OFFLINE', message: '' })).toContain('offline')
    expect(describeError({ code: 'INTERNAL', message: 'boom' })).toBe('boom')
    expect(describeError({ code: 'INTERNAL', message: '' })).toBe('Something went wrong.')
  })
})
