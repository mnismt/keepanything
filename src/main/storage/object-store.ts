import { copyFile, rm } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, sep } from 'node:path'
import {
  ensureDir,
  pathExistsSync,
  safeFilename,
  sha256Bytes,
  sha256File,
  statOrNull,
  writeFileAtomic
} from '../lib/fs'
import type { Paths } from '../ports'

/** Result of storing bytes or a file in the object store. */
export interface StoredObject {
  /** Path relative to `objects/` (goes into `items.managed_path`). */
  managedPath: string
  absolutePath: string
  size: number
  sha256: string
}

/**
 * Managed copies live at `objects/<itemId>/<safe-name>`. The store never touches originals except
 * to read them; deleting an item removes only its managed directory.
 */
export interface ObjectStore {
  /** Absolute path for a `managed_path` (relative to `objects/`). Throws on traversal. */
  resolve(managedPath: string): string
  /** Copy a file into the item's directory. Hashes the source (streaming). */
  copyFile(itemId: string, sourcePath: string, preferredName?: string): Promise<StoredObject>
  /** Write bytes into the item's directory. */
  writeBytes(itemId: string, name: string, bytes: Uint8Array): Promise<StoredObject>
  /** Delete the item's managed directory (no-op when absent). */
  removeItem(itemId: string): Promise<void>
  /** True when the managed copy is on disk. */
  managedExists(managedPath: string): boolean
  /** True when the referenced original is on disk. */
  originalExists(originalPath: string): boolean
}

export function createObjectStore(paths: Paths): ObjectStore {
  const root = paths.objectsDir
  const resolve = (managedPath: string): string => {
    if (isAbsolute(managedPath)) throw new Error('managed_path must be relative')
    const abs = join(root, managedPath)
    const rel = relative(root, abs)
    if (rel.startsWith('..') || rel.split(sep).includes('..') || isAbsolute(rel)) {
      throw new Error('managed_path escapes the object store')
    }
    return abs
  }
  const dirFor = (itemId: string): string => resolve(safeFilename(itemId, 'item'))

  return {
    resolve,
    async copyFile(itemId, sourcePath, preferredName) {
      const dir = dirFor(itemId)
      await ensureDir(dir)
      const name = safeFilename(preferredName ?? basename(sourcePath))
      const target = join(dir, name)
      await copyFile(sourcePath, target)
      const [hash, stats] = await Promise.all([sha256File(target), statOrNull(target)])
      return { managedPath: `${basename(dir)}/${name}`, absolutePath: target, size: stats?.size ?? 0, sha256: hash }
    },
    async writeBytes(itemId, name, bytes) {
      const dir = dirFor(itemId)
      const safe = safeFilename(name)
      const target = join(dir, safe)
      await writeFileAtomic(target, bytes)
      return {
        managedPath: `${basename(dir)}/${safe}`,
        absolutePath: target,
        size: bytes.byteLength,
        sha256: sha256Bytes(bytes)
      }
    },
    async removeItem(itemId) {
      await rm(dirFor(itemId), { recursive: true, force: true })
    },
    managedExists(managedPath) {
      try {
        return pathExistsSync(resolve(managedPath))
      } catch {
        return false
      }
    },
    originalExists(originalPath) {
      return isAbsolute(originalPath) && pathExistsSync(originalPath)
    }
  }
}
