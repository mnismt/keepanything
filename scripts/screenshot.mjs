/**
 * Launches the built app (`pnpm exec electron-vite build` first) and captures the real library window
 * with macOS `screencapture` into `.artifacts/screenshot.png` (gitignored). The terminal may need
 * Screen Recording permission for window contents to appear.
 *
 * Usage: pnpm run screenshot [-- --theme dark|light] [--out <file>] [--reset] [--settings] [--page]
 *
 *   --theme   Force the appearance for the shot (default: dark). Sets `nativeTheme.themeSource`
 *             in the running app only; nothing is persisted.
 *   --out     Output file (default `.artifacts/screenshot.png`; light defaults to
 *             `.artifacts/screenshot-light.png`).
 *   --reset   Wipe the E2E profile first. Without it the existing profile is reused.
 *
 * Either way an empty library is filled with `scripts/seed-library.mjs` placeholder content, so the
 * masonry always has something to lay out; a profile that already has items is left alone.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { _electron as electron } from '@playwright/test'
import { seedLibrary } from './seed-library.mjs'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const theme = option('--theme', 'dark')
if (theme !== 'dark' && theme !== 'light') {
  console.error(`--theme must be dark or light (got ${theme})`)
  process.exit(2)
}
const out = resolve(
  option('--out', theme === 'light' ? '.artifacts/screenshot-light.png' : '.artifacts/screenshot.png')
)
mkdirSync(dirname(out), { recursive: true })

if (args.includes('--reset')) rmSync(join(tmpdir(), 'keepanything-e2e'), { recursive: true, force: true })

const app = await electron.launch({
  args: [resolve('out/main/index.js')],
  env: { ...process.env, KEEPANYTHING_E2E: '1' }
})
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(500)

// The app pins `nativeTheme.themeSource` to the Settings theme, so the appearance is switched through
// settings (E2E profile only) and restored afterwards.
const before = await page.evaluate(() => window.keepAnything.invoke('settings:get', undefined))
const previousTheme = before.ok ? before.data.theme : 'system'
await page.evaluate((t) => window.keepAnything.invoke('settings:update', { theme: t }), theme)

// macOS Electron emits `open-file` for command-line path arguments, which the app captures as items;
// an `electron <script>` launch therefore imports its own bundle. Keep those out of the picture.
const root = resolve('.')
const listed = await page.evaluate(() => window.keepAnything.invoke('items:list', { view: 'library', limit: 500 }))
const stray = []
for (const item of listed.ok ? listed.data : []) {
  const detail = await page.evaluate((id) => window.keepAnything.invoke('items:get', { id }), item.id)
  const original = detail.ok ? detail.data.item.originalPath : null
  if (original && (original.startsWith(join(root, 'node_modules')) || original.startsWith(join(root, 'out'))))
    stray.push(item.id)
}
if (stray.length > 0) {
  await page.evaluate((ids) => window.keepAnything.invoke('items:deleteForever', { ids }), stray)
  console.log(`Removed ${stray.length} item(s) captured from the launch command line`)
}

// An empty library screenshots as an empty state, which is useless for layout review.
await seedLibrary(page, { log: (m) => console.log(m) })

// Let the first paint, the initial IPC round-trip and lazy thumbnails settle.
await page.waitForTimeout(1500)

// A consistent 1440×900 window for the capture; the masonry reflows before the shot.
const bounds = await app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows()[0]
  win.setSize(1440, 900)
  win.center()
  return win.getBounds()
})
if (args.includes('--settings')) {
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.waitForTimeout(400)
}
await page.waitForTimeout(600)
try {
  if (args.includes('--page')) throw new Error('page')
  execFileSync('screencapture', ['-x', '-R', `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`, out], {
    stdio: 'pipe'
  })
  console.log(`Theme ${theme} · window bounds ${JSON.stringify(bounds)} · screencapture\nScreenshot written to ${out}`)
} catch {
  // No Screen Recording permission for this terminal: capture the web contents through DevTools instead
  // (same pixels minus the native traffic lights).
  await page.screenshot({ path: out })
  console.log(
    `Theme ${theme} · window bounds ${JSON.stringify(bounds)} · page.screenshot fallback\nScreenshot written to ${out}`
  )
}
await page.evaluate((t) => window.keepAnything.invoke('settings:update', { theme: t }), previousTheme)
await app.close()
