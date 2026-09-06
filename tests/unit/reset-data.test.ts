import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applyPendingDataReset, finishDataReset, requestDataReset } from '../../src/main/storage/reset-data'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('reset data', () => {
  it('clears app data on next launch while preserving originals and runtime models', () => {
    const root = mkdtempSync(join(tmpdir(), 'ka-reset-test-'))
    roots.push(root)
    const profile = join(root, 'profile')
    mkdirSync(profile)
    const original = join(root, 'original.txt')
    writeFileSync(original, 'original content')
    const directories = ['objects', 'thumbs', 'snapshots', 'content', 'logs', 'url-cache']
    const files = ['library.db', 'library.db-wal', 'library.db-shm', 'library.db-journal', 'config.json']
    for (const dir of [...directories, 'models']) {
      mkdirSync(join(profile, dir))
      writeFileSync(join(profile, dir, 'data'), 'stored data')
    }
    symlinkSync(original, join(profile, 'objects', 'linked-original'))
    for (const file of files) writeFileSync(join(profile, file), 'stored data')
    expect(applyPendingDataReset(profile)).toBe(false)
    requestDataReset(profile)
    expect(existsSync(join(profile, 'library.db'))).toBe(true)
    expect(applyPendingDataReset(profile)).toBe(true)
    for (const entry of [...directories, ...files]) expect(existsSync(join(profile, entry))).toBe(false)
    expect(readFileSync(original, 'utf8')).toBe('original content')
    expect(existsSync(join(profile, 'models', 'data'))).toBe(true)
    expect(applyPendingDataReset(profile)).toBe(true)
    finishDataReset(profile)
    expect(applyPendingDataReset(profile)).toBe(false)
  })

  it('unlinks managed-directory symlinks without traversing original folders', () => {
    const root = mkdtempSync(join(tmpdir(), 'ka-reset-test-'))
    roots.push(root)
    const profile = join(root, 'profile')
    const originals = join(root, 'originals')
    mkdirSync(profile)
    mkdirSync(originals)
    writeFileSync(join(originals, 'keep.txt'), 'keep')
    symlinkSync(originals, join(profile, 'objects'))
    requestDataReset(profile)
    applyPendingDataReset(profile)
    expect(readFileSync(join(originals, 'keep.txt'), 'utf8')).toBe('keep')
  })
})
