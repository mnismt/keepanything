import { BrowserWindow, session } from 'electron'
import { LIMITS } from '../../shared/constants'
import { FETCH_USER_AGENT, SNAPSHOT_PARTITION } from '../desktop/dom-fallback'
import { writeFileAtomic } from '../lib/fs'
import type { Logger, SnapshotOptions, SnapshotResult, Snapshotter } from '../ports'
import { dominantColor } from './color'

/**
 * URL snapshots: one reusable offscreen `BrowserWindow` (1280×800, sandbox,
 * throwaway `snapshot` partition, dialogs disabled, downloads/window.open/webview blocked,
 * navigation denied once the page has loaded, permissions denied), load raced against 15 s,
 * `fonts.ready` + settle, `capturePage` -> PNG. Optionally a full-page JPEG when under 8 MB.
 * Calls are serialised, so the io lane may call concurrently.
 */

/** Load budget (ms). */
export const SNAPSHOT_LOAD_MS = 15_000
/** Settle after load (ms). */
const SETTLE_MS = 700
/** Idle time after which the window is destroyed (ms). */
const IDLE_MS = 60_000
const FULL_PAGE_MAX_HEIGHT = 6_000
const FULL_PAGE_MAX_BYTES = 8 * 1024 * 1024
/** HTML returned for extraction (chars). */
const MAX_HTML_CHARS = 2_000_000

export type { SnapshotOptions, SnapshotResult }

/** The full `Snapshotter` port. */
export type SnapshotMaker = Snapshotter

/** True for URLs that render nothing worth snapshotting (PDF viewer chrome). */
export function isPdfUrl(url: string): boolean {
  try {
    return /\.pdf$/i.test(new URL(url).pathname)
  } catch {
    return false
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export function createSnapshotter(logger: Logger): SnapshotMaker {
  let window: BrowserWindow | null = null
  let loaded = false
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let busy: Promise<unknown> = Promise.resolve()

  const partition = session.fromPartition(SNAPSHOT_PARTITION)
  partition.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  partition.setPermissionCheckHandler(() => false)
  partition.on('will-download', (event) => event.preventDefault())

  const dispose = (): void => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = null
    if (window && !window.isDestroyed()) window.destroy()
    window = null
  }

  const armIdle = (): void => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(dispose, IDLE_MS)
  }

  const ensureWindow = (): BrowserWindow => {
    if (window && !window.isDestroyed()) return window
    window = new BrowserWindow({
      show: false,
      width: LIMITS.snapshotWidth,
      height: LIMITS.snapshotHeight,
      transparent: false,
      backgroundColor: '#ffffff',
      webPreferences: {
        offscreen: true,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        partition: SNAPSHOT_PARTITION,
        disableDialogs: true,
        plugins: false,
        webgl: false,
        devTools: false,
        javascript: true,
        backgroundThrottling: false
      }
    })
    const contents = window.webContents
    contents.setUserAgent(FETCH_USER_AGENT)
    contents.setAudioMuted(true)
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-attach-webview', (event) => event.preventDefault())
    // Redirects during the initial load are fine; scripted navigation after load is not.
    contents.on('will-navigate', (event) => {
      if (loaded) event.preventDefault()
    })
    return window
  }

  const capture = async (url: string, outPath: string, opts: SnapshotOptions): Promise<SnapshotResult | null> => {
    if (opts.signal?.aborted) return null
    const win = ensureWindow()
    const contents = win.webContents
    loaded = false
    try {
      win.setContentSize(LIMITS.snapshotWidth, LIMITS.snapshotHeight)
      let aborted = false
      const abort = (): void => {
        aborted = true
        contents.stop()
      }
      opts.signal?.addEventListener('abort', abort, { once: true })
      try {
        await Promise.race([contents.loadURL(url).catch(() => undefined), sleep(SNAPSHOT_LOAD_MS)])
        loaded = true
        if (aborted) return null
        await Promise.race([
          contents
            .executeJavaScript('document.fonts && document.fonts.ready.then(() => true)', true)
            .catch(() => undefined),
          sleep(2_000)
        ])
        await sleep(SETTLE_MS)
        if (aborted) return null
        const currentUrl = contents.getURL()
        if (!currentUrl || currentUrl === 'about:blank' || currentUrl.startsWith('chrome-error://')) return null

        const image = await contents.capturePage()
        if (image.isEmpty()) return null
        const shot =
          image.getSize().width > LIMITS.snapshotWidth ? image.resize({ width: LIMITS.snapshotWidth }) : image
        await writeFileAtomic(outPath, shot.toPNG())
        const size = shot.getSize()
        const result: SnapshotResult = { width: size.width, height: size.height, finalUrl: currentUrl }
        const title = contents.getTitle().trim()
        if (title) result.title = title
        try {
          const small = shot.resize({ width: 32, quality: 'good' })
          const s = small.getSize()
          const colour = dominantColor(new Uint8Array(small.toBitmap()), s.width, s.height, 'bgra')
          if (colour) result.dominantColor = colour
        } catch {
          // colour is optional
        }
        try {
          const html = (await contents.executeJavaScript('document.documentElement.outerHTML', true)) as unknown
          if (typeof html === 'string' && html.length > 0) result.html = html.slice(0, MAX_HTML_CHARS)
        } catch {
          // html is optional
        }

        if (opts.fullPagePath && !aborted) {
          try {
            const height = (await contents.executeJavaScript(
              'Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)',
              true
            )) as unknown
            const fullHeight = Math.min(FULL_PAGE_MAX_HEIGHT, Math.max(LIMITS.snapshotHeight, Number(height) || 0))
            if (fullHeight > LIMITS.snapshotHeight + 100) {
              win.setContentSize(LIMITS.snapshotWidth, fullHeight)
              await sleep(300)
              const full = await contents.capturePage()
              if (!full.isEmpty()) {
                const jpeg = full.toJPEG(80)
                if (jpeg.byteLength <= FULL_PAGE_MAX_BYTES) {
                  await writeFileAtomic(opts.fullPagePath, jpeg)
                  const fs = full.getSize()
                  result.fullPage = {
                    path: opts.fullPagePath,
                    width: fs.width,
                    height: fs.height,
                    bytes: jpeg.byteLength
                  }
                }
              }
            }
          } catch (error) {
            logger.debug('full-page snapshot failed', { url, error })
          }
        }
        return result
      } finally {
        opts.signal?.removeEventListener('abort', abort)
      }
    } catch (error) {
      logger.debug('snapshot failed', { url, error })
      return null
    } finally {
      loaded = false
      if (window && !window.isDestroyed()) {
        window.setContentSize(LIMITS.snapshotWidth, LIMITS.snapshotHeight)
        void window.webContents.loadURL('about:blank').catch(() => undefined)
      }
      armIdle()
    }
  }

  return {
    snapshot(url, outPath, opts = {}) {
      const run = (): Promise<SnapshotResult | null> => capture(url, outPath, opts)
      const result = busy.then(run, run)
      busy = result.catch(() => undefined)
      return result
    },
    dispose
  }
}
