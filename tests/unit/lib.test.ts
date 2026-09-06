import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildContextMenu } from '../../src/main/desktop/context-menu'
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
import type { SecretStore } from '../../src/main/ports'
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
  it('emits structured lines and redacts secrets', () => {
    const lines: string[] = []
    const log = createLogger({ sinks: [(line) => lines.push(line)], secrets: ['sk-test-123'] })
    log.info('user logged in', { email: 'a@b.c', token: 'sk-test-123' })
    expect(JSON.parse(lines[0] ?? '{}').token).toBe('[redacted]')
    expect(redact('sk-test-123', ['sk-test-123'])).toBe('[redacted]')
    expect(silentLogger.info).toBeTypeOf('function')
  })
})

describe('fs helpers', () => {
  it('produces safe file names', () => {
    expect(safeFilename('../../etc/passwd')).toBe('passwd')
    expect(safeFilename('  .hidden: name/with\\slashes.txt ')).toBe('slashes.txt')
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
  it('returns manual timestamps', () => {
    const clock = createManualClock('2026-01-01T00:00:00Z')
    expect(clock.nowIso()).toBe('2026-01-01T00:00:00.000Z')
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
    expect(env.providers?.gmi?.apiKey).toBe('sk-env-1234567890abcdef')
    expect(env.providers?.gmi?.model).toBe('m')
    const document = openConfigDocument(join(dir, 'config.json'))
    const secrets = createMemorySecretStore()
    const store = createSettingsStore({ document, secrets, env, paths: buildPaths(dir) })
    const initial = store.get()
    expect(initial).toMatchObject({
      aiMode: 'gmi',
      provider: 'gmi',
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
      version: number
      settings: Record<string, unknown>
      secrets: Record<string, unknown>
    }
    expect(written.version).toBe(2)
    expect(written.settings).toMatchObject({
      theme: 'dark',
      importMode: 'reference',
      providers: { gmi: { baseUrl: 'https://x.y/v1' } }
    })
    expect(JSON.stringify(written)).not.toContain('sk-stored')

    store.update({ clearApiKey: true })
    expect(store.apiKey()).toBe('sk-env-1234567890abcdef')
    store.update({ ai: 'off' })
    expect(store.aiStatus()).toBe('off')
    const noKey = createSettingsStore({ document, secrets: createMemorySecretStore(), env: {}, paths: buildPaths(dir) })
    noKey.update({ ai: 'on' })
    expect(noKey.aiStatus()).toBe('unconfigured')
    expect(maskApiKey('short')).toBe('••••')
  })

  it('migrates a literal version-1 document and isolates per-provider profiles', () => {
    const dir = tempDir()
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({
        version: 1,
        settings: {
          aiMode: 'gmi',
          model: 'legacy-model',
          baseUrl: 'https://legacy.example/v1',
          theme: 'dark'
        },
        secrets: { gmiApiKey: 'stored-base64-payload' }
      })
    )
    const document = openConfigDocument(join(dir, 'config.json'))
    const secrets: SecretStore = {
      available: () => true,
      get(key) {
        const enc = document.read().secrets[key]
        return enc ? Buffer.from(enc, 'base64').toString('utf8') : null
      },
      set(key, val) {
        document.write((doc) => {
          doc.secrets[key] = Buffer.from(val).toString('base64')
        })
      },
      delete(key) {
        document.write((doc) => {
          delete doc.secrets[key]
        })
      }
    }
    secrets.set('gmiApiKey', 'legacy-stored-key')
    const store = createSettingsStore({
      document,
      secrets,
      env: readEnvDefaults({
        KEEPANYTHING_OPENROUTER_API_KEY: 'env-openrouter-key',
        KEEPANYTHING_OPENROUTER_MODEL: 'env-or-model'
      }),
      paths: buildPaths(dir)
    })
    const initial = store.get()
    expect(initial).toMatchObject({
      provider: 'gmi',
      aiMode: 'gmi',
      model: 'legacy-model',
      baseUrl: 'https://legacy.example/v1',
      theme: 'dark',
      hasApiKey: true,
      apiKeyMasked: 'leg…-key'
    })

    store.update({
      provider: 'openrouter',
      apiKey: 'openrouter-stored-1234567890abcdef',
      model: 'openai/gpt-4o-mini',
      baseUrl: 'https://custom.example/v1/'
    })
    expect(store.get()).toMatchObject({
      provider: 'openrouter',
      aiMode: 'openrouter',
      model: 'openai/gpt-4o-mini',
      baseUrl: 'https://custom.example/v1',
      hasApiKey: true
    })
    expect(store.apiKey()).toBe('openrouter-stored-1234567890abcdef')

    store.update({ provider: 'gmi' })
    expect(store.get().provider).toBe('gmi')
    expect(store.apiKey()).toBe('legacy-stored-key')

    store.update({ provider: 'openrouter' })
    expect(store.apiKey()).toBe('openrouter-stored-1234567890abcdef')
    store.update({ model: '', provider: 'openrouter' })
    expect(store.get().model).toBe('minimax/minimax-m3:free')
    store.update({ provider: 'gmi' })
    expect(store.get().model).toBe('legacy-model')

    store.update({ provider: 'openrouter', model: 'override' })
    expect(store.get().model).toBe('override')

    const written = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')) as {
      version: number
      settings: Record<string, unknown>
      secrets: Record<string, unknown>
    }
    expect(written.version).toBe(2)
    expect(written.settings).not.toHaveProperty('model')
    expect(written.settings).not.toHaveProperty('baseUrl')
    expect(written.secrets).toHaveProperty('gmiApiKey')
    expect(written.secrets).toHaveProperty('openrouterApiKey')
    expect(JSON.stringify(written)).not.toContain('openrouter-stored')
    expect(JSON.stringify(written)).not.toContain('legacy-stored')

    // Old GMI env vars must not populate OpenRouter.
    store.update({ clearApiKey: true, provider: 'openrouter' })
    expect(store.apiKey()).toBe('env-openrouter-key')
    expect(document.read().secrets).not.toHaveProperty('openrouterApiKey')
    expect(document.read().secrets).toHaveProperty('gmiApiKey')
  })

  it('throws on an unsupported settings version without rewriting the file', () => {
    const dir = tempDir()
    const file = join(dir, 'config.json')
    writeFileSync(file, JSON.stringify({ version: 99, settings: { aiMode: 'gmi' }, secrets: {} }))
    expect(() => openConfigDocument(file).read()).toThrow(/Unsupported settings/)
    expect(readFileSync(file, 'utf8')).toContain('"version":99')
  })
})

describe('media resolution', () => {
  it('parses valid media URLs and rejects others', () => {
    expect(parseMediaUrl('ka-media://local/objects/abc?w=200')).toEqual({
      root: 'objects',
      relPath: 'abc',
      version: 0
    })
    expect(parseMediaUrl('https://evil.example')).toBeNull()
  })
  it('resolves library media paths and refuses escapes', () => {
    const dir = tempDir()
    const paths = buildPaths(dir)
    expect(resolveMediaPath(paths, { root: 'objects', relPath: '../escape', version: 0 })).toBeNull()
  })
})

describe('context menu templates', () => {
  it('builds a per-item menu with the right labels', () => {
    const items = buildContextMenu({
      kind: 'item',
      items: [{ id: 'a', type: 'file', deletedAt: null, url: null, isMissing: false }],
      collections: [],
      collectionId: undefined
    })
    const reveal = items.find((m) => 'label' in m && m.label === 'Reveal in Finder')
    expect(reveal).toBeDefined()
  })
})

describe('theme', () => {
  it('resolves system theme to light/dark', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })
})
