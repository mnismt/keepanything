import { existsSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { app } from 'electron'
import type { Logger } from '../ports'

export interface ActivationActions {
  showLibrary(): void
  /** Paths handed over by Finder ("Open With", drops on the Dock icon, second instances). */
  captureFiles(paths: string[]): Promise<void>
}

/** Absolute, existing paths from an argv (second instance) — everything else is a flag. */
export function pathsFromArgv(argv: readonly string[]): string[] {
  return argv.filter((arg) => isAbsolute(arg) && !arg.startsWith('--') && existsSync(arg))
}

/**
 * Dock/activate/second-instance/open-file wiring. Regular app: no `LSUIElement`,
 * no `dock.hide()`; the window manager switches the activation policy when the library hides.
 */
export function installActivation(actions: ActivationActions, logger: Logger): void {
  const pendingOpens: string[] = []
  // macOS re-announces argv paths through `open-file` (e.g. the script passed to `electron .` or a
  // Playwright loader); those are launch arguments, never something the user asked to keep.
  const launchArgs = new Set(process.argv)
  let ready = false

  const flush = (): void => {
    if (!ready || pendingOpens.length === 0) return
    const paths = pendingOpens.splice(0)
    actions.showLibrary()
    void actions.captureFiles(paths).catch((error: unknown) => logger.warn('open-file capture failed', { error }))
  }

  app.on('open-file', (event, path) => {
    event.preventDefault()
    if (launchArgs.has(path)) return
    pendingOpens.push(path)
    flush()
  })
  app.on('activate', () => actions.showLibrary())
  app.on('second-instance', (_event, argv) => {
    actions.showLibrary()
    const paths = pathsFromArgv(argv.slice(1))
    if (paths.length > 0) pendingOpens.push(...paths)
    flush()
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  void app.whenReady().then(() => {
    ready = true
    flush()
  })
}
