/**
 * Envelope unwrapping, pure (no DOM) so it is unit-testable under node.
 * Every invoke resolves to `{ ok: true, data } | { ok: false, error }`; the renderer works with
 * `Result<T>` and never throws across the bridge.
 */
import type { IpcEnvelope, IpcError, IpcErrorCode } from '../../../shared/ipc'

export type Result<T> = { ok: true; data: T } | { ok: false; error: IpcError }

const TRANSPORT_ERROR: IpcError = { code: 'INTERNAL', message: 'The app did not answer.' }

/** Turn whatever came back from the bridge into a well-formed `Result`. Malformed -> INTERNAL. */
export function unwrapEnvelope<T>(value: unknown): Result<T> {
  if (typeof value !== 'object' || value === null) return { ok: false, error: TRANSPORT_ERROR }
  const v = value as Partial<IpcEnvelope<T>> & { error?: Partial<IpcError> }
  if (v.ok === true) return { ok: true, data: (v as { data: T }).data }
  if (v.ok === false) {
    const e = v.error
    if (e && typeof e.code === 'string' && typeof e.message === 'string') {
      return { ok: false, error: { code: e.code as IpcErrorCode, message: e.message } }
    }
    return { ok: false, error: TRANSPORT_ERROR }
  }
  return { ok: false, error: TRANSPORT_ERROR }
}

/** Build a failure result (used by the mock bridge and by local guards). */
export function failure(code: IpcErrorCode, message: string): Result<never> {
  return { ok: false, error: { code, message } }
}

export function success<T>(data: T): Result<T> {
  return { ok: true, data }
}

/** User-safe one-liner for an error, in product voice. */
export function describeError(error: IpcError): string {
  switch (error.code) {
    case 'AI_NOT_CONFIGURED':
      return 'Connect GMI in Settings to do this.'
    case 'AI_UNAVAILABLE':
    case 'OFFLINE':
      return 'AI is offline right now. Your library is fine.'
    case 'NOT_FOUND':
      return "Couldn't find that anymore."
    case 'CANCELLED':
      return 'Stopped.'
    default:
      return error.message || 'Something went wrong.'
  }
}
