import { type ChildProcessByStdio, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { Readable } from 'node:stream'
import type { Logger } from '../ports'

export type DragWatchEvent =
  | { event: 'ready' }
  | { event: 'drag-start'; types: string[]; folders: number }
  | { event: 'drag-end' }
  | { event: 'tick' }

export interface DragWatchActions {
  /** A drag session began somewhere on the desktop; `folders` is how many dragged files are directories. */
  onDragStart(types: readonly string[], folders: number): void
  /** That drag ended (dropped or cancelled). */
  onDragEnd(): void
}

export interface DragWatcher {
  running(): boolean
  stop(): void
}

/** stdin is closed; stdout carries the protocol and stderr only ever gets crash noise. */
type Sidecar = ChildProcessByStdio<null, Readable, Readable>

/** Give up after this many unexpected exits; a broken sidecar must not become a spawn loop. */
const MAX_RESTARTS = 3

const RESTART_DELAY_MS = 2000

/** Parse one stdout line. Returns null for blank lines and anything unrecognised. */
export function parseDragWatchLine(line: string): DragWatchEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const { event, types, folders } = parsed as { event?: unknown; types?: unknown; folders?: unknown }
  if (event === 'ready' || event === 'drag-end' || event === 'tick') return { event }
  if (event === 'drag-start') {
    const list = Array.isArray(types) ? types.filter((t): t is string => typeof t === 'string') : []
    return { event: 'drag-start', types: list, folders: typeof folders === 'number' && folders > 0 ? folders : 0 }
  }
  return null
}

/**
 * Start watching for drags. `binaryPath` is the compiled sidecar (`build/native/ka-drag-watch` in
 * dev, `<resources>/native/ka-drag-watch` when packaged); a missing one is logged, not thrown.
 */
export function startDragWatch(binaryPath: string, actions: DragWatchActions, logger: Logger): DragWatcher {
  let child: Sidecar | null = null
  let restarts = 0
  let stopped = false
  let restartTimer: ReturnType<typeof setTimeout> | null = null

  if (!existsSync(binaryPath)) {
    logger.info('drag watcher not installed; the shelf opens from the menu bar, ⌘⇧K and ⌘V', { binaryPath })
    return { running: () => false, stop: () => {} }
  }

  const start = (): void => {
    if (stopped) return
    let buffer = ''
    let sidecar: Sidecar
    try {
      sidecar = spawn(binaryPath, [], { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      logger.warn('could not start the drag watcher', { error })
      return
    }
    child = sidecar

    sidecar.stdout.setEncoding('utf8')
    sidecar.stdout.on('data', (chunk: string) => {
      buffer += chunk
      const lines = buffer.split('\n')
      // The last element is whatever came after the final newline: an incomplete line, or ''.
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const event = parseDragWatchLine(line)
        if (!event) continue
        if (event.event === 'drag-start') actions.onDragStart(event.types, event.folders)
        else if (event.event === 'drag-end') actions.onDragEnd()
        else if (event.event === 'ready') logger.debug('drag watcher ready')
      }
    })
    sidecar.stderr.setEncoding('utf8')
    sidecar.stderr.on('data', (chunk: string) => logger.debug('drag watcher stderr', { chunk: chunk.trim() }))

    sidecar.on('error', (error) => logger.warn('drag watcher failed', { error }))
    sidecar.on('exit', (code, signal) => {
      child = null
      if (stopped) return
      restarts += 1
      if (restarts > MAX_RESTARTS) {
        logger.warn('drag watcher keeps exiting; giving up', { code, signal, restarts })
        return
      }
      logger.debug('restarting the drag watcher', { code, signal, restarts })
      restartTimer = setTimeout(start, RESTART_DELAY_MS)
    })
  }

  start()

  return {
    running: () => child !== null,
    stop() {
      stopped = true
      if (restartTimer) clearTimeout(restartTimer)
      restartTimer = null
      child?.kill()
      child = null
    }
  }
}
