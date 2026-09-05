/**
 * Typed bridge access for the renderer.
 */

import type { KeepAnythingApi } from '../../../preload/api'
import type { IpcChannel, IpcEventMap, IpcEventName, IpcRequestMap, IpcResponseMap } from '../../../shared/ipc'
import { type Result, unwrapEnvelope } from './envelope'
import { createMockBridge } from './mock-bridge'

export type { Result } from './envelope'
export { describeError } from './envelope'

let bridge: KeepAnythingApi | null = null
let usingMock = false

/** The active bridge, installing the mock on first use when the preload is missing. */
export function getBridge(): KeepAnythingApi {
  if (bridge) return bridge
  if (typeof window !== 'undefined' && window.keepAnything) {
    bridge = window.keepAnything
  } else {
    bridge = createMockBridge()
    usingMock = true
    if (typeof window !== 'undefined') window.keepAnything = bridge
  }
  return bridge
}

/** True when the renderer runs against fixture data instead of main. */
export function isMockBridge(): boolean {
  getBridge()
  return usingMock
}

/** Request/response. Never throws: transport failures are `{ ok: false }` results. */
export async function invoke<C extends IpcChannel>(
  channel: C,
  payload: IpcRequestMap[C]
): Promise<Result<IpcResponseMap[C]>> {
  try {
    const envelope = await getBridge().invoke(channel, payload)
    return unwrapEnvelope<IpcResponseMap[C]>(envelope)
  } catch (error) {
    return {
      ok: false,
      error: { code: 'INTERNAL', message: error instanceof Error ? error.message : 'Bridge failure' }
    }
  }
}

/** Subscribe to a push event; returns the unsubscribe function. */
export function on<E extends IpcEventName>(event: E, listener: (payload: IpcEventMap[E]) => void): () => void {
  return getBridge().on(event, listener)
}

/** Absolute path of a dropped `File`; empty string when it has none. */
export function getPathForFile(file: File): string {
  return getBridge().getPathForFile(file)
}

export function platform(): 'darwin' | 'other' {
  return getBridge().platform
}
