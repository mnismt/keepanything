import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  type IpcChannel,
  type IpcEnvelope,
  type IpcErrorCode,
  type IpcEventMap,
  type IpcEventName,
  type IpcRequestMap,
  type IpcResponseMap,
  isIpcChannel,
  isIpcEnvelope,
  isIpcEventName
} from '../shared/ipc'
import type { KeepAnythingApi } from './api'

// Sandboxed preload: only `electron` and dependency-free `../shared/*` may be imported here.

function failure<T>(code: IpcErrorCode, message: string): IpcEnvelope<T> {
  return { ok: false, error: { code, message } }
}

const api: KeepAnythingApi = {
  async invoke<C extends IpcChannel>(channel: C, payload: IpcRequestMap[C]): Promise<IpcEnvelope<IpcResponseMap[C]>> {
    if (!isIpcChannel(channel)) {
      return failure('VALIDATION', `Unknown IPC channel "${String(channel)}"`)
    }
    try {
      const result: unknown = await ipcRenderer.invoke(channel, payload)
      if (isIpcEnvelope(result)) return result as IpcEnvelope<IpcResponseMap[C]>
      return failure('INTERNAL', `Malformed response on "${channel}"`)
    } catch (error) {
      return failure('INTERNAL', error instanceof Error ? error.message : String(error))
    }
  },

  on<E extends IpcEventName>(event: E, listener: (payload: IpcEventMap[E]) => void): () => void {
    if (!isIpcEventName(event)) {
      return () => {}
    }
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      listener(payload as IpcEventMap[E])
    }
    ipcRenderer.on(event, handler)
    return () => {
      ipcRenderer.removeListener(event, handler)
    }
  },

  getPathForFile(file: File): string {
    return webUtils.getPathForFile(file)
  },

  platform: process.platform === 'darwin' ? 'darwin' : 'other'
}

contextBridge.exposeInMainWorld('keepAnything', api)
