import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { AiMode } from '../shared/types'
import { isAiMode } from './lib/settings'

/** True when running via `electron-vite dev` / `preview` or a bare `electron out/main/index.js` (not packaged). */
export const isDev = !app.isPackaged

/** Playwright smoke test run: separate `userData`, test hooks allowed. */
export const e2eMode = process.env.KEEPANYTHING_E2E === '1'

/** Verbose logging (`KEEPANYTHING_DEBUG=1`). */
export const debugMode = process.env.KEEPANYTHING_DEBUG === '1'

/**
 * Dev convenience: load the gitignored `.env` from the project root into `process.env` (variables
 * already set in the environment win). Values are never logged. No-op when packaged.
 */
export function loadDotEnv(): void {
  if (app.isPackaged) return
  const file = join(app.getAppPath(), '.env')
  if (!existsSync(file)) return
  try {
    process.loadEnvFile(file)
  } catch {
    // Malformed .env: ignore, the app runs without it.
  }
}

/**
 * AI mode requested by the environment (`KEEPANYTHING_AI`), if any. The effective mode is decided
 * by the settings store (stored value -> this -> `gmi` with a key, `mock` without). E2E runs default
 * to `mock` so tests never reach the network.
 */
export function envAiMode(): AiMode | undefined {
  const raw = process.env.KEEPANYTHING_AI
  if (isAiMode(raw)) return raw
  return e2eMode ? 'mock' : undefined
}
