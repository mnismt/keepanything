/**
 * Drag and drop helpers. Internal drags carry item ids under `INTERNAL_DND_MIME`; external drops are
 * snapshotted RAW for `capture:drop` (the renderer never classifies what was dropped).
 */
import { INTERNAL_DND_MIME } from '../../../shared/constants'
import type { CaptureDropRequest } from '../../../shared/ipc'
import type { CaptureDropSource } from '../../../shared/types'

/** Mark a drag as an internal move of these items. */
export function setInternalDrag(dt: DataTransfer, ids: readonly string[]): void {
  dt.setData(INTERNAL_DND_MIME, JSON.stringify(ids))
  dt.effectAllowed = 'copyMove'
}

/** True when the drag originated inside the app (types are readable before drop). */
export function isInternalDrag(dt: DataTransfer | null): boolean {
  return Boolean(dt && Array.from(dt.types).includes(INTERNAL_DND_MIME))
}

/** Item ids carried by an internal drag, or an empty list. */
export function readInternalDrag(dt: DataTransfer | null): string[] {
  if (!dt) return []
  try {
    const raw = dt.getData(INTERNAL_DND_MIME)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

/** True when the drag has anything the intake could keep (files, links, text, html). */
export function hasExternalPayload(dt: DataTransfer | null): boolean {
  if (!dt) return false
  const types = Array.from(dt.types)
  return (
    types.includes('Files') ||
    types.includes('text/uri-list') ||
    types.includes('text/plain') ||
    types.includes('text/html')
  )
}

/**
 * Raw dataTransfer snapshot for `capture:drop`. Paths come from the preload (`getPathForFile`);
 * Files without a disk path are ignored here (the intake decides what to do with html/text).
 */
export function snapshotDrop(
  dt: DataTransfer,
  getPathForFile: (file: File) => string,
  source: CaptureDropSource,
  collectionId?: string
): CaptureDropRequest {
  const files: string[] = []
  for (const file of Array.from(dt.files)) {
    const path = getPathForFile(file)
    if (path) files.push(path)
  }
  const uriList = dt.getData('text/uri-list') || undefined
  const text = dt.getData('text/plain') || undefined
  const html = dt.getData('text/html') || undefined
  const request: CaptureDropRequest = { files, source }
  if (uriList) request.uriList = uriList
  if (text) request.text = text
  if (html) request.html = html
  if (collectionId) request.collectionId = collectionId
  return request
}

/** Same snapshot for a paste event (⌘V): the intake owns URL-vs-text. */
export function snapshotPaste(
  dt: DataTransfer,
  getPathForFile: (file: File) => string,
  source: CaptureDropSource,
  collectionId?: string
): CaptureDropRequest | null {
  const request = snapshotDrop(dt, getPathForFile, source, collectionId)
  if (request.files.length === 0 && !request.uriList && !request.text && !request.html) return null
  return request
}

/** Image/blob files in a paste or drop that have no disk path (clipboard screenshots). */
export function blobFiles(dt: DataTransfer, getPathForFile: (file: File) => string): File[] {
  return Array.from(dt.files).filter((file) => !getPathForFile(file) && file.size > 0)
}
