import type { IpcErrorCode } from '../../shared/ipc'

/**
 * The one error type that crosses layer boundaries. Handlers throw it; the IPC router maps
 * `code`/`message` into the error envelope. `details` is for logs only and never reaches the
 * renderer. Honest stubs throw `new KaError('NOT_IMPLEMENTED', 'items:list')`.
 */
export class KaError extends Error {
  readonly code: IpcErrorCode
  readonly details?: unknown

  constructor(code: IpcErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'KaError'
    this.code = code
    if (details !== undefined) this.details = details
  }
}

/** True when `value` is a `KaError` (works across bundles: checks the shape, not the prototype). */
export function isKaError(value: unknown): value is KaError {
  if (value instanceof KaError) return true
  if (typeof value !== 'object' || value === null) return false
  const v = value as { name?: unknown; code?: unknown; message?: unknown }
  return v.name === 'KaError' && typeof v.code === 'string' && typeof v.message === 'string'
}
