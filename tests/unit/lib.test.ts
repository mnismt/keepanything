import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildContextMenu } from '../../src/main/desktop/context-menu'
import { parseRange } from '../../src/main/desktop/media-protocol'
import { resolveTheme } from '../../src/main/desktop/theme'
import { createManualClock } from '../../src/main/lib/clock'
import { safeFilename, sha256Bytes, writeFileAtomic } from '../../src/main/lib/fs'
import { createLogger, redact, silentLogger } from '../../src/main/lib/logger'
import {
  createMemorySecretStore,
  createSettingsStore,
  maskApiKey,
  openConfigDocument,
  readEnvDefaults
} from '../../src/main/lib/settings'
import { createWorkerClient, type WorkerProcess } from '../../src/main/lib/worker-client'
import { buildPaths, resolveMediaPath } from '../../src/main/storage/paths'
import { parseMediaUrl } from '../../src/shared/media'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
const tempDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'ka-lib-'))
  dirs.push(d)
  return d
}

describe('logger', () => {
  it('writes JSON lines above the level, merges child fields and redacts secrets', () => {
    const lines: string[] = []
    const logger = createLogger({
      level: 'info',
      sinks: [(l) => lines.push(l)],
      secrets: ['my-real-key-value'],
      now: () => 'T'
    })
    const child = logger.child({ scope: 'x' })
    child.debug('hidden')
    child.info('hello', {
      apiKey: 'plain',
      nested: { token: 'abc' },
      note: 'bearer Bearer abcdefghijkl',
      key: 'sk-abcdefghijklmnop',
      env: 'uses my-real-key-value here'
    })
    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>
    expect(record).toMatchObject({
      ts: 'T',
      level: 'info',
      msg: 'hello',
      scope: 'x',
      apiKey: '[redacted]',
      nested: { token: '[redacted]' }
    })
    expect(record.key).toBe('[redacted]')
    expect(record.note).toBe('bearer Bearer [redacted]')
    expect(record.env).toBe('uses [redacted] here')
    expect(JSON.stringify(record)).not.toContain('my-real-key-value')
  })

  it('serializes errors and cuts cycles', () => {
    const cyclic: Record<string, unknown> = { a: 1 }
    cyclic.self = cyclic
    const out = redact({ error: new Error('boom sk-abcdefghijklmnop'), cyclic }, []) as {
      error: { message: string }
      cyclic: { self: string }
    }
    expect(out.error.message).toBe('boom [redacted]')
    expect(out.cyclic.self).toBe('[circular]')
  })

  it('keeps token usage counters visible while redacting token-like secrets', () => {
    const out = redact(
      { promptTokens: 1200, completionTokens: 80, maxTokens: 4096, accessToken: 'abc', refresh_token: 'def' },
      []
    ) as Record<string, unknown>
    expect(out.promptTokens).toBe(1200)
    expect(out.completionTokens).toBe(80)
    expect(out.maxTokens).toBe(4096)
    expect(out.accessToken).toBe('[redacted]')
    expect(out.refresh_token).toBe('[redacted]')
  })
})

describe('fs helpers', () => {
  it('produces safe file names', () => {
    expect(safeFilename('../../etc/passwd')).toBe('passwd')
    expect(safeFilename('  .hidden: name/with\\slashes.txt ')).toBe('slashes.txt') // last path segment only
    expect(safeFilename('.hidden: name.txt')).toBe('hidden name.txt')
    expect(safeFilename('')).toBe('file')
    expect(safeFilename('a'.repeat(300) + '.png')).toHaveLength(180)
    expect(safeFilename('a'.repeat(300) + '.png').endsWith('.png')).toBe(true)
  })

  it('writes atomically and hashes bytes', async () => {
    const dir = tempDir()
    const file = join(dir, 'nested', 'a.txt')
    await writeFileAtomic(file, 'hello')
    expect(readFileSync(file, 'utf8')).toBe('hello')
    expect(sha256Bytes('hello')).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
  })
})

describe('clock', () => {
  it('manual clock advances deterministically', () => {
    const clock = createManualClock('2026-01-01T00:00:00.000Z')
    clock.advance(1500)
    expect(clock.nowIso()).toBe('2026-01-01T00:00:01.500Z')
    clock.set('2027-01-01T00:00:00.000Z')
    expect(clock.now().getUTCFullYear()).toBe(2027)
  })
})

describe('settings store', () => {
  it('reads env defaults without leaking, masks the key, persists updates and resolves ai status', () => {
    const dir = tempDir()
    const env = readEnvDefaults({
      KEEPANYTHING_GMI_API_KEY: 'sk-env-1234567890abcdef',
      KEEPANYTHING_AI: 'bogus',
      KEEPANYTHING_MODEL: 'm'
    })
    expect(env).toEqual({ apiKey: 'sk-env-1234567890abcdef', model: 'm' })
    const document = openConfigDocument(join(dir, 'config.json'))
    const secrets = createMemorySecretStore()
    const store = createSettingsStore({ document, secrets, env, paths: buildPaths(dir) })
    const initial = store.get()
    expect(initial).toMatchObject({
      aiMode: 'gmi',
      model: 'm',
      hasApiKey: true,
      apiKeyMasked: 'sk-…cdef',
      importMode: 'copy',
      theme: 'system',
      libraryPath: dir
    })
    expect(initial.embeddings).toEqual({ provider: 'none', modelPresent: false, dims: 384 })
    expect(store.aiStatus()).toBe('connected')

    const changes: string[] = []
    store.onChange((s) => changes.push(s.theme))
    store.update({
      theme: 'dark',
      importMode: 'reference',
      apiKey: 'sk-stored-1234567890abcdef',
      baseUrl: 'https://x.y/v1/'
    })
    expect(changes).toEqual(['dark'])
    expect(store.apiKey()).toBe('sk-stored-1234567890abcdef')
    const written = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')) as {
      settings: Record<string, unknown>
      secrets: Record<string, unknown>
    }
    expect(written.settings).toEqual({ theme: 'dark', importMode: 'reference', baseUrl: 'https://x.y/v1' })
    expect(JSON.stringify(written)).not.toContain('sk-stored')

    store.update({ clearApiKey: true })
    expect(store.apiKey()).toBe('sk-env-1234567890abcdef') // env fallback remains
    store.update({ aiMode: 'off' })
    expect(store.aiStatus()).toBe('off')
    const noKey = createSettingsStore({ document, secrets: createMemorySecretStore(), env: {}, paths: buildPaths(dir) })
    noKey.update({ aiMode: 'gmi' })
    expect(noKey.aiStatus()).toBe('unconfigured')
    expect(maskApiKey('short')).toBe('••••')
  })
})

describe('worker client', () => {
  function fakeProcess(): WorkerProcess & {
    emit(event: 'message' | 'exit', payload: unknown): void
    sent: unknown[]
    killed: boolean
  } {
    const handlers = new Map<string, ((p: never) => void)[]>()
    const sent: unknown[] = []
    return {
      sent,
      killed: false,
      postMessage: (m) => sent.push(m),
      on(event: string, listener: (p: never) => void) {
        handlers.set(event, [...(handlers.get(event) ?? []), listener])
        return this
      },
      kill() {
        this.killed = true
        return true
      },
      emit(event, payload) {
        for (const l of handlers.get(event) ?? []) l(payload as never)
      }
    }
  }

  it('spawns lazily, correlates responses by id, and rejects everything on crash', async () => {
    const procs: ReturnType<typeof fakeProcess>[] = []
    const client = createWorkerClient({
      fork: () => {
        const p = fakeProcess()
        procs.push(p)
        return p
      },
      logger: silentLogger,
      idleMs: 0
    })
    expect(procs).toHaveLength(0)
    const call = client.call<string>('ping', undefined)
    expect(procs).toHaveLength(1)
    const request = procs[0]?.sent[0] as { id: string; task: string }
    expect(request.task).toBe('ping')
    procs[0]?.emit('message', { id: request.id, ok: true, result: 'pong' })
    await expect(call).resolves.toBe('pong')

    const failing = client.call('pdfText', {})
    const req2 = procs[0]?.sent[1] as { id: string }
    procs[0]?.emit('message', { id: req2.id, ok: false, error: { code: 'NOT_IMPLEMENTED', message: 'nope' } })
    await expect(failing).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' })

    const pending = client.call('slow', {})
    procs[0]?.emit('exit', 1)
    await expect(pending).rejects.toMatchObject({ code: 'INTERNAL' })
    const afterCrash = client.call('ping', undefined)
    expect(procs).toHaveLength(2) // respawned after the crash
    client.terminate()
    expect(procs[1]?.killed).toBe(true)
    await expect(afterCrash).rejects.toMatchObject({ code: 'INTERNAL' })
  })

  it('times out and honours abort signals', async () => {
    vi.useFakeTimers()
    try {
      const client = createWorkerClient({ fork: fakeProcess, logger: silentLogger, idleMs: 0 })
      const slow = client.call('x', {}, { timeoutMs: 50 })
      vi.advanceTimersByTime(60)
      await expect(slow).rejects.toMatchObject({ code: 'INTERNAL' })
      const controller = new AbortController()
      const aborted = client.call('y', {}, { signal: controller.signal })
      controller.abort()
      await expect(aborted).rejects.toMatchObject({ code: 'CANCELLED' })
      client.terminate()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('media resolution', () => {
  const paths = buildPaths('/lib')

  it('resolves only inside the library roots', () => {
    const ok = parseMediaUrl('ka-media://local/thumbs/abc.png?v=2')
    expect(ok && resolveMediaPath(paths, ok)).toBe('/lib/thumbs/abc.png')
    const nested = parseMediaUrl('ka-media://local/objects/item-1/My%20File.pdf?v=1')
    expect(nested && resolveMediaPath(paths, nested)).toBe('/lib/objects/item-1/My File.pdf')
    expect(parseMediaUrl('ka-media://local/thumbs/..%2F..%2Flibrary.db')).toBeNull()
    expect(parseMediaUrl('ka-media://local/logs/x.log')).toBeNull()
    expect(resolveMediaPath(paths, { root: 'thumbs', relPath: '../library.db', version: 0 })).toBeNull()
    expect(resolveMediaPath(paths, { root: 'thumbs', relPath: 'a/../../x', version: 0 })).toBeNull()
  })

  it('parses range headers', () => {
    expect(parseRange(null, 100)).toBeNull()
    expect(parseRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 })
    expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=50-500', 100)).toEqual({ start: 50, end: 99 })
    expect(parseRange('bytes=60-50', 100)).toBeNull()
    expect(parseRange('items=1-2', 100)).toBeNull()
  })
})

describe('context menu templates', () => {
  it('builds per-kind menus with collection submenus', () => {
    const collections = [{ id: 'c1', name: 'Doan Labs' }]
    const item = buildContextMenu({
      kind: 'item',
      items: [{ id: 'a', type: 'url', deletedAt: null, url: 'https://x', isMissing: false }],
      collections
    })
    const labels = item.map((e) => ('label' in e ? e.label : '—'))
    expect(labels).toEqual([
      'Open Link',
      'Quick Look',
      'Reveal in Finder',
      'Copy Link',
      '—',
      'Add to Collection',
      '—',
      'Try Again',
      '—',
      'Move to Trash'
    ])
    const add = item.find((e) => 'label' in e && e.label === 'Add to Collection')
    expect(add && 'submenu' in add && add.submenu?.[0]).toEqual({ label: 'Doan Labs', action: 'add-to-collection:c1' })
    const trashed = buildContextMenu({
      kind: 'item',
      items: [{ id: 'a', type: 'pdf', deletedAt: 'now', url: null, isMissing: false }],
      collections
    })
    expect(trashed.map((e) => ('action' in e ? e.action : 'sep'))).toEqual(['restore', 'sep', 'delete-forever'])
    const missing = buildContextMenu({
      kind: 'item',
      items: [{ id: 'a', type: 'pdf', deletedAt: null, url: null, isMissing: true }],
      collections
    })
    expect(missing[0]).toEqual({ label: 'Open', action: 'open', enabled: false })
    expect(
      buildContextMenu({ kind: 'items', items: [], collections, collectionId: 'c1' }).some(
        (e) => 'action' in e && e.action === 'remove-from-collection'
      )
    ).toBe(true)
    expect(buildContextMenu({ kind: 'collection', items: [], collections }).length).toBe(3)
    expect(buildContextMenu({ kind: 'background', items: [], collections }).length).toBe(6)
  })
})

describe('theme', () => {
  it('resolves the system preference', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
  })
})
