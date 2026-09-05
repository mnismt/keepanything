import { BrowserWindow, session } from 'electron'
import { LIMITS } from '../../shared/constants'
import type { Logger, PageFetcher } from '../ports'

/** Browser-like UA so sites serve the normal page. */
export const FETCH_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'

/** Session partition shared by snapshot and DOM-fallback windows (throwaway, downloads blocked). */
export const SNAPSHOT_PARTITION = 'snapshot'

/** Idle time after which the offscreen window is destroyed (ms). */
const IDLE_MS = 60_000

/** Cap on HTML kept in memory per page (chars). */
const MAX_HTML_CHARS = 5_000_000

/**
 * `PageFetcher` implementation: plain `fetch` with a browser UA and timeout, plus a DOM fallback
 * that renders JS-heavy pages in a reusable offscreen `BrowserWindow` (sandboxed, own partition,
 * dialogs disabled, downloads and window.open blocked) and returns `documentElement.outerHTML`.
 * Extraction decides when to fall back (`< 400` readable chars).
 */
export function createPageFetcher(logger: Logger): PageFetcher & { dispose(): void } {
  let window: BrowserWindow | null = null
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let busy: Promise<unknown> = Promise.resolve()

  const partition = session.fromPartition(SNAPSHOT_PARTITION)
  partition.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
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
      webPreferences: {
        offscreen: true,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        partition: SNAPSHOT_PARTITION,
        disableDialogs: true,
        images: false,
        webgl: false,
        devTools: false
      }
    })
    window.webContents.setUserAgent(FETCH_USER_AGENT)
    window.webContents.setAudioMuted(true)
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-attach-webview', (event) => event.preventDefault())
    return window
  }

  const fetchDom = async (url: string): Promise<{ html: string; title: string; finalUrl: string } | null> => {
    const run = async (): Promise<{ html: string; title: string; finalUrl: string } | null> => {
      const win = ensureWindow()
      const contents = win.webContents
      try {
        await Promise.race([
          contents.loadURL(url).catch(() => undefined),
          new Promise((resolve) => setTimeout(resolve, LIMITS.snapshotTimeoutMs))
        ])
        await new Promise((resolve) => setTimeout(resolve, 700))
        const html = (await contents.executeJavaScript('document.documentElement.outerHTML', true)) as string
        return {
          html: typeof html === 'string' ? html.slice(0, MAX_HTML_CHARS) : '',
          title: contents.getTitle(),
          finalUrl: contents.getURL() || url
        }
      } catch (error) {
        logger.debug('dom fallback failed', { url, error })
        return null
      } finally {
        void contents.loadURL('about:blank').catch(() => undefined)
        armIdle()
      }
    }
    const result = busy.then(run, run)
    busy = result.catch(() => undefined)
    return result
  }

  return {
    async fetchHtml(url) {
      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': FETCH_USER_AGENT,
            Accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8'
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(LIMITS.fetchTimeoutMs)
        })
        const contentType = response.headers.get('content-type') ?? ''
        const html = /text\/|xml|json/.test(contentType) ? (await response.text()).slice(0, MAX_HTML_CHARS) : ''
        return { status: response.status, finalUrl: response.url || url, contentType, html }
      } catch (error) {
        logger.debug('fetchHtml failed', { url, error })
        return null
      }
    },
    fetchDom,
    dispose
  }
}
