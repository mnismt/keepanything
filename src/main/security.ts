import { app, session, shell, type WebContents } from 'electron'
import { MEDIA_SCHEME } from '../shared/constants'
import { isDev } from './env'

/**
 * Production CSP. Must stay identical to `PRODUCTION_CSP` in `electron.vite.config.ts`, which
 * injects it as a `<meta>` tag at build time; this copy is sent as a response header.
 */
export const PRODUCTION_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${MEDIA_SCHEME}:`,
  `media-src ${MEDIA_SCHEME}:`,
  "font-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ')

/** Development CSP: production plus what Vite HMR needs (inline React Refresh preamble, websocket). */
export const DEVELOPMENT_CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${MEDIA_SCHEME}:`,
  `media-src ${MEDIA_SCHEME}:`,
  "font-src 'self'",
  "connect-src 'self' ws://localhost:* ws://127.0.0.1:* http://localhost:* http://127.0.0.1:*",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ')

/** Attach the Content Security Policy header to every response in the default session. */
export function installContentSecurityPolicy(): void {
  const csp = isDev ? DEVELOPMENT_CSP : PRODUCTION_CSP
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
      }
    })
  })

  // App windows never need any permission (camera, notifications, etc.).
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
}

function isAllowedUrl(url: string): boolean {
  if (url.startsWith('file://')) return true
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (isDev && devUrl && url.startsWith(devUrl)) return true
  return false
}

export interface HardenOptions {
  /**
   * App windows: stray `target=_blank` https anchors open in the default browser. Offscreen
   * snapshot / DOM-fallback windows: never (a page must not be able to launch anything).
   */
  openExternalLinks: boolean
}

/** Block navigation away from the bundled renderer, refuse webviews and new windows. */
export function hardenWebContents(contents: WebContents, options: HardenOptions): void {
  contents.on('will-navigate', (event, url) => {
    if (!isAllowedUrl(url)) event.preventDefault()
  })
  contents.on('will-attach-webview', (event) => event.preventDefault())
  contents.setWindowOpenHandler(({ url }) => {
    if (options.openExternalLinks && /^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
}

/**
 * Harden every web contents created outside our control (defence in depth). App windows re-apply
 * `hardenWebContents` with their own options afterwards, so the last `setWindowOpenHandler` wins.
 */
export function denyUnexpectedWebContents(): void {
  app.on('web-contents-created', (_event, contents) => {
    hardenWebContents(contents, { openExternalLinks: false })
  })
}
