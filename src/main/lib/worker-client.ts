import { randomUUID } from 'node:crypto'
import { KaError } from '../core/errors'
import type { Logger, WorkerCallOptions, WorkerClient } from '../ports'
import { isWorkerResponse, type WorkerRequest } from '../worker/rpc'

/** The subset of `Electron.UtilityProcess` the client needs (injectable for tests). */
export interface WorkerProcess {
  postMessage(message: unknown): void
  on(event: 'message', listener: (message: unknown) => void): unknown
  on(event: 'exit', listener: (code: number) => void): unknown
  kill(): boolean
}

export interface WorkerClientDeps {
  /** Spawn the worker (`utilityProcess.fork(out/main/worker.js)`); called lazily and after crashes. */
  fork(): WorkerProcess
  logger: Logger
  /** Terminate the worker after this long without calls (default 60 s; 0 disables). */
  idleMs?: number
  /** Default per-call timeout (default 120 s). */
  defaultTimeoutMs?: number
}

interface Pending {
  resolve(value: unknown): void
  reject(error: unknown): void
  timer: ReturnType<typeof setTimeout> | null
  onAbort: (() => void) | null
  signal: AbortSignal | undefined
}

/**
 * Client for the utility-process worker: lazy spawn, request ids, per-call timeouts and abort
 * signals, restart on crash (pending calls reject with `INTERNAL`; callers/jobs retry), idle
 * termination, explicit `terminate()`.
 */
export function createWorkerClient(deps: WorkerClientDeps): WorkerClient {
  const { fork, logger } = deps
  const idleMs = deps.idleMs ?? 60_000
  const defaultTimeoutMs = deps.defaultTimeoutMs ?? 120_000
  const pending = new Map<string, Pending>()
  let child: WorkerProcess | null = null
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let generation = 0

  const settle = (id: string): Pending | undefined => {
    const p = pending.get(id)
    if (!p) return undefined
    pending.delete(id)
    if (p.timer) clearTimeout(p.timer)
    if (p.onAbort && p.signal) p.signal.removeEventListener('abort', p.onAbort)
    armIdle()
    return p
  }

  const armIdle = (): void => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = null
    if (idleMs > 0 && pending.size === 0 && child) {
      idleTimer = setTimeout(() => {
        if (pending.size === 0) terminate('idle')
      }, idleMs)
    }
  }

  const terminate = (reason: string): void => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = null
    const current = child
    child = null
    generation += 1
    if (current) {
      logger.debug('worker terminated', { reason })
      try {
        current.kill()
      } catch {
        // already gone
      }
    }
    for (const id of [...pending.keys()]) {
      settle(id)?.reject(new KaError('INTERNAL', `Worker terminated (${reason})`))
    }
  }

  const ensureChild = (): WorkerProcess => {
    if (child) return child
    const proc = fork()
    const myGeneration = ++generation
    child = proc
    logger.debug('worker spawned')
    proc.on('message', (message) => {
      if (!isWorkerResponse(message)) return
      const p = settle(message.id)
      if (!p) return
      if (message.ok) p.resolve(message.result)
      else p.reject(new KaError(message.error.code, message.error.message))
    })
    proc.on('exit', (code) => {
      if (generation !== myGeneration || child !== proc) return
      child = null
      logger.warn('worker exited', { code, pending: pending.size })
      for (const id of [...pending.keys()]) {
        settle(id)?.reject(new KaError('INTERNAL', `Worker crashed (exit ${code})`))
      }
    })
    return proc
  }

  return {
    call<T>(task: string, payload: unknown, opts: WorkerCallOptions = {}): Promise<T> {
      if (opts.signal?.aborted) return Promise.reject(new KaError('CANCELLED', 'Cancelled'))
      const proc = ensureChild()
      const id = randomUUID()
      const request: WorkerRequest = { id, task, payload }
      return new Promise<T>((resolve, reject) => {
        const timeoutMs = opts.timeoutMs ?? defaultTimeoutMs
        const entry: Pending = {
          resolve: (v) => resolve(v as T),
          reject,
          timer: null,
          onAbort: null,
          signal: opts.signal
        }
        if (timeoutMs > 0) {
          entry.timer = setTimeout(() => {
            settle(id)?.reject(new KaError('INTERNAL', `Worker task "${task}" timed out after ${timeoutMs} ms`))
          }, timeoutMs)
        }
        if (opts.signal) {
          entry.onAbort = () => settle(id)?.reject(new KaError('CANCELLED', 'Cancelled'))
          opts.signal.addEventListener('abort', entry.onAbort, { once: true })
        }
        pending.set(id, entry)
        if (idleTimer) clearTimeout(idleTimer)
        try {
          proc.postMessage(request)
        } catch (error) {
          settle(id)?.reject(new KaError('INTERNAL', error instanceof Error ? error.message : String(error)))
        }
      })
    },
    terminate: () => terminate('explicit')
  }
}
