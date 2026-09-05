import { resolve } from 'node:path'
import { type ElectronApplication, _electron as electron, expect, type Page, test } from '@playwright/test'
import type { IpcEnvelope } from '../../src/shared/ipc'
import type { SystemStats } from '../../src/shared/types'

/**
 * Electron smoke test against the *built* app (`pnpm run build` first). KEEPANYTHING_E2E=1 gives the
 * run its own `userData` (so it never collides with a dev or packaged instance) and forces the mock
 * AI mode. It exercises main through the preload bridge only; the renderer's DOM is not asserted.
 */

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  app = await electron.launch({
    args: [resolve(__dirname, '../../out/main/index.js')],
    env: { ...process.env, KEEPANYTHING_E2E: '1', KEEPANYTHING_AI: 'mock', NODE_ENV: 'production' }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
})

test('launches one visible, resizable library window titled KeepAnything', async () => {
  await expect
    .poll(async () =>
      app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w.isVisible()).length)
    )
    .toBe(1)
  const windows = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .filter((w) => w.isVisible())
      .map((w) => ({
        resizable: w.isResizable(),
        title: w.getTitle(),
        minimumSize: w.getMinimumSize()
      }))
  )
  const [win] = windows
  expect(win?.resizable).toBe(true)
  expect(win?.title).toContain('KeepAnything')
  expect(win?.minimumSize).toEqual([960, 640])
})

test('exposes the preload bridge', async () => {
  const bridge = await page.evaluate(() => ({
    hasInvoke: typeof window.keepAnything?.invoke === 'function',
    hasOn: typeof window.keepAnything?.on === 'function',
    hasGetPath: typeof window.keepAnything?.getPathForFile === 'function',
    platform: window.keepAnything?.platform
  }))
  expect(bridge.hasInvoke).toBe(true)
  expect(bridge.hasOn).toBe(true)
  expect(bridge.hasGetPath).toBe(true)
  expect(['darwin', 'other']).toContain(bridge.platform)
})

test('system:stats round-trips through main with a fresh, migrated library', async () => {
  const result = (await page.evaluate(() =>
    window.keepAnything.invoke('system:stats', undefined)
  )) as IpcEnvelope<SystemStats>
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.data).toMatchObject({
    items: expect.any(Number),
    connections: expect.any(Number),
    collections: expect.any(Number)
  })
  expect(['off', 'connected', 'offline', 'unconfigured']).toContain(result.data.aiStatus)

  const collections = await page.evaluate(() => window.keepAnything.invoke('collections:list', undefined))
  expect(collections).toMatchObject({ ok: true, data: expect.any(Array) })

  const items = await page.evaluate(() => window.keepAnything.invoke('items:list', { view: 'library' }))
  expect(items).toMatchObject({ ok: true, data: expect.any(Array) })
})

test('captures text through intake and the scheduler settles it', async () => {
  const captured = (await page.evaluate(
    (stamp) =>
      window.keepAnything.invoke('capture:text', {
        // Unique per run: the E2E profile is reused by other scripts, and an identical text would dedupe.
        text: `Remember to compare inference providers on price. (smoke ${stamp})`,
        title: 'Smoke note'
      }),
    Date.now()
  )) as IpcEnvelope<{ items: { id: string; status: string }[] }>
  expect(captured.ok).toBe(true)
  if (!captured.ok) return
  const id = captured.data.items[0]?.id ?? ''
  expect(captured.data.items[0]?.status).toBe('created')

  await expect
    .poll(
      async () => {
        const detail = (await page.evaluate(
          (itemId) => window.keepAnything.invoke('items:get', { id: itemId }),
          id
        )) as IpcEnvelope<{
          item: { processingStatus: string }
        }>
        return detail.ok ? detail.data.item.processingStatus : 'error'
      },
      { timeout: 20_000 }
    )
    .toMatch(/^(READY|PARTIAL)$/)

  const listed = (await page.evaluate(() =>
    window.keepAnything.invoke('items:list', { view: 'library' })
  )) as IpcEnvelope<{ id: string }[]>
  expect(listed.ok && listed.data.some((s) => s.id === id)).toBe(true)
})

test('validates payloads in main and rejects unknown channels in the preload', async () => {
  const invalid = await page.evaluate(() =>
    (window.keepAnything.invoke as (c: string, p: unknown) => Promise<unknown>)('items:get', { nope: 1 })
  )
  expect(invalid).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })

  const missing = await page.evaluate(() => window.keepAnything.invoke('items:get', { id: 'does-not-exist' }))
  expect(missing).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })

  const unknown = await page.evaluate(() =>
    (window.keepAnything.invoke as (c: string, p: unknown) => Promise<unknown>)('nope:nothing', undefined)
  )
  expect(unknown).toEqual({ ok: false, error: { code: 'VALIDATION', message: 'Unknown IPC channel "nope:nothing"' } })
})

test('quits cleanly', async () => {
  const pid = await app.evaluate(() => process.pid)
  await app.evaluate(({ app }) => app.quit())
  await app.waitForEvent('close')
  await expect
    .poll(() => {
      try {
        process.kill(pid, 0)
        return 'alive'
      } catch {
        return 'exited'
      }
    })
    .toBe('exited')
})
