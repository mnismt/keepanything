import type { IpcChannel, IpcEnvelope, IpcEventMap, IpcEventName, IpcRequestMap, IpcResponseMap } from '../shared/ipc'

/**
 * The surface exposed to the renderer as `window.keepAnything` via `contextBridge`.
 * Typed end to end by the maps in `shared/ipc.ts`; the preload validates channel and event
 * names against the const maps before touching `ipcRenderer`.
 */
export interface KeepAnythingApi {
  /** Request/response. Never rejects: transport failures come back as `{ ok: false }` envelopes. */
  invoke<C extends IpcChannel>(channel: C, payload: IpcRequestMap[C]): Promise<IpcEnvelope<IpcResponseMap[C]>>
  /** Subscribe to a push event. Returns the unsubscribe function. */
  on<E extends IpcEventName>(event: E, listener: (payload: IpcEventMap[E]) => void): () => void
  /** Absolute path of a dropped `File` (Electron `webUtils.getPathForFile`); empty string if none. */
  getPathForFile(file: File): string
  /** Static platform info; the renderer never touches `process`. */
  platform: 'darwin' | 'other'
}

declare global {
  interface Window {
    keepAnything: KeepAnythingApi
  }
}
