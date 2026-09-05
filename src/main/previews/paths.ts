import { isAbsolute, join, relative, sep } from 'node:path'
import type { Paths } from '../ports'

/** Pure path helpers shared by the stages and the Electron-backed preview makers. */

/** `thumbs/<itemId>.png` (relative value stored in `items.thumbnail_path`). */
export function thumbnailRelPath(itemId: string): string {
  return `${itemId}.png`
}

export function thumbnailFile(paths: Paths, itemId: string): string {
  return join(paths.thumbsDir, thumbnailRelPath(itemId))
}

/** `snapshots/<itemId>.png` (relative value stored in `items.snapshot_path`). */
export function snapshotRelPath(itemId: string): string {
  return `${itemId}.png`
}

export function snapshotFile(paths: Paths, itemId: string): string {
  return join(paths.snapshotsDir, snapshotRelPath(itemId))
}

/** Full-page capture next to the viewport snapshot. */
export function snapshotFullRelPath(itemId: string): string {
  return `${itemId}.full.jpg`
}

export function snapshotFullFile(paths: Paths, itemId: string): string {
  return join(paths.snapshotsDir, snapshotFullRelPath(itemId))
}

/** ≤1280 px JPEG for the vision path, kept under `content/`. */
export function visionRelPath(itemId: string): string {
  return `${itemId}.vision.jpg`
}

export function visionFile(paths: Paths, itemId: string): string {
  return join(paths.contentDir, visionRelPath(itemId))
}

/** Absolute path of a managed copy; null when the relative path would escape `objects/`. */
export function managedFile(paths: Paths, managedPath: string): string | null {
  if (isAbsolute(managedPath)) return null
  const abs = join(paths.objectsDir, managedPath)
  const rel = relative(paths.objectsDir, abs)
  if (rel.length === 0 || rel.startsWith('..') || rel.split(sep).includes('..') || isAbsolute(rel)) return null
  return abs
}
