/**
 * Request/response protocol between main (`lib/worker-client.ts`) and the utility-process worker
 * (`worker/index.ts`). Messages travel over `MessagePortMain` and must be structured-cloneable.
 * Pure types + guards; no Electron imports so the worker bundle stays independent.
 */

import type { IpcErrorCode } from '../../shared/ipc'

/** Main -> worker. `task` names a registered worker task (`'ping'` is built in). */
export interface WorkerRequest {
  id: string
  task: string
  payload?: unknown
}

export interface WorkerSuccess {
  id: string
  ok: true
  result: unknown
}

/** Worker -> main, failure. `code` maps onto `KaError` codes in main. */
export interface WorkerFailure {
  id: string
  ok: false
  error: { code: IpcErrorCode; message: string }
}

export type WorkerResponse = WorkerSuccess | WorkerFailure

export type WorkerTaskHandler = (payload: unknown, signal: AbortSignal) => Promise<unknown> | unknown

/** Task registry shape merged by `worker/index.ts` from extraction and embeddings tasks. */
export type WorkerTaskRegistry = Readonly<Record<string, WorkerTaskHandler>>

export function isWorkerRequest(value: unknown): value is WorkerRequest {
  if (typeof value !== 'object' || value === null) return false
  const v = value as { id?: unknown; task?: unknown }
  return typeof v.id === 'string' && typeof v.task === 'string'
}

export function isWorkerResponse(value: unknown): value is WorkerResponse {
  if (typeof value !== 'object' || value === null) return false
  const v = value as { id?: unknown; ok?: unknown; error?: unknown }
  if (typeof v.id !== 'string') return false
  if (v.ok === true) return true
  if (v.ok !== false) return false
  const e = v.error as { code?: unknown; message?: unknown } | undefined
  return typeof e === 'object' && e !== null && typeof e.code === 'string' && typeof e.message === 'string'
}
