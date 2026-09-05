import { join } from 'node:path'
import { BrowserWindow } from 'electron'
import { isDev } from '../env'
import { hardenWebContents } from '../security'

/** Matches `--bg-0` in the renderer tokens; avoids a flash before the first paint. */
export const LIBRARY_WINDOW_BACKGROUND = '#141210'

/** Default and minimum library window size (DIP). */
export const LIBRARY_WINDOW_SIZE = { width: 1200, height: 800, minWidth: 960, minHeight: 640 } as const

/** Renderer routes (`?view=`). */
export type RendererView = 'library' | 'shelf'

/** Load the bundled renderer (or the Vite dev server) into `window` for one view. */
export function loadRenderer(window: BrowserWindow, view: RendererView): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (isDev && devUrl) {
    const url = new URL(devUrl)
    url.searchParams.set('view', view)
    void window.loadURL(url.toString())
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), { query: { view } })
  }
}

export function appWebPreferences(): Electron.WebPreferences {
  return {
    preload: join(__dirname, '../preload/index.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    spellcheck: false,
    devTools: isDev
  }
}

/** Create the main library window (regular, resizable, hidden native title bar). */
export function createLibraryWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: LIBRARY_WINDOW_SIZE.width,
    height: LIBRARY_WINDOW_SIZE.height,
    minWidth: LIBRARY_WINDOW_SIZE.minWidth,
    minHeight: LIBRARY_WINDOW_SIZE.minHeight,
    show: false,
    title: 'KeepAnything',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: LIBRARY_WINDOW_BACKGROUND,
    webPreferences: appWebPreferences()
  })
  hardenWebContents(window.webContents, { openExternalLinks: true })
  window.once('ready-to-show', () => window.show())
  loadRenderer(window, 'library')
  return window
}
