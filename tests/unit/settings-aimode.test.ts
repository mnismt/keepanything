import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createMemorySecretStore,
  createSettingsStore,
  isAiMode,
  openConfigDocument,
  readEnvDefaults
} from '../../src/main/lib/settings'
import { buildPaths } from '../../src/main/storage/paths'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const storeIn = (
  dir: string,
  env: Parameters<typeof createSettingsStore>[0]['env'],
  stored?: 'gmi' | 'mock' | 'off'
) => {
  const document = openConfigDocument(join(dir, 'config.json'))
  if (stored)
    document.write((doc) => {
      doc.settings.aiMode = stored
    })
  return createSettingsStore({ document, secrets: createMemorySecretStore(), env, paths: buildPaths(dir) })
}
const tempDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'ka-aimode-'))
  dirs.push(d)
  return d
}

describe('aiMode: env-only mock', () => {
  it('readEnvDefaults preserves mock (KEEPANYTHING_AI=mock still drives mock in dev)', () => {
    expect(readEnvDefaults({ KEEPANYTHING_AI: 'mock' }).aiMode).toBe('mock')
    expect(readEnvDefaults({ KEEPANYTHING_AI: 'bogus' }).aiMode).toBeUndefined()
  })

  it('isAiMode accepts every runtime mode', () => {
    expect(['gmi', 'mock', 'off'].every(isAiMode)).toBe(true)
    expect(isAiMode('bogus')).toBe(false)
  })

  it('a stored mock is ignored, not honoured', () => {
    expect(storeIn(tempDir(), {}, 'mock').get().aiMode).toBe('off')
  })

  it('env aiMode applies when nothing is stored; a stored mode wins over env', () => {
    expect(storeIn(tempDir(), { aiMode: 'mock' }).get().aiMode).toBe('mock')
    expect(storeIn(tempDir(), { aiMode: 'mock' }, 'gmi').get().aiMode).toBe('gmi')
  })

  it('fresh install without key defaults to off, not mock', () => {
    expect(storeIn(tempDir(), {}).get().aiMode).toBe('off')
  })
})
