// One-off: same as `pnpm run seed:library` but against the dev profile (no KEEPANYTHING_E2E),
// so the library the running dev app opens is the one that gets seeded.

import { resolve } from 'node:path'
import { _electron as electron } from '@playwright/test'
import { seedLibrary } from './scripts/seed-library.mjs'

const app = await electron.launch({ args: [resolve('out/main/index.js')], env: { ...process.env } })
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(800)

const invoke = async (channel, payload) => {
  const env = await page.evaluate(([c, p]) => window.keepAnything.invoke(c, p), [channel, payload])
  if (env?.ok !== true) throw new Error(`${channel}: ${env?.error?.message ?? 'no envelope'}`)
  return env.data
}

// macOS open-file captures the launch argument itself; drop those before seeding.
const root = resolve('.')
const stray = []
for (const item of await invoke('items:list', { view: 'library', limit: 500 })) {
  const { item: detail } = await invoke('items:get', { id: item.id })
  if (detail.originalPath?.startsWith(`${root}/out`) || detail.originalPath?.startsWith(`${root}/node_modules`))
    stray.push(item.id)
}
if (stray.length) await invoke('items:deleteForever', { ids: stray })

console.log(await seedLibrary(page, { timeoutMs: 300_000, force: true }))
await app.close()
