import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const RESET_MARKER = 'reset-pending'
// Only app-owned entries; never derive deletion targets from item original paths.
const RESET_ENTRIES = [
  'library.db',
  'library.db-wal',
  'library.db-shm',
  'library.db-journal',
  'objects',
  'thumbs',
  'snapshots',
  'content',
  'logs',
  'url-cache',
  'config.json'
] as const

export function requestDataReset(userData: string): void {
  writeFileSync(join(userData, RESET_MARKER), '', { mode: 0o600 })
}

// Run in the next process, before opening the database or starting any producers.
// Leave the marker on failure so a partial reset is retried on the next launch.
export function applyPendingDataReset(userData: string): boolean {
  const marker = join(userData, RESET_MARKER)
  if (!existsSync(marker)) return false
  for (const entry of RESET_ENTRIES) rmSync(join(userData, entry), { recursive: true, force: true })
  return true
}

export function finishDataReset(userData: string): void {
  rmSync(join(userData, RESET_MARKER), { force: true })
}
