/**
 * `ka-media://` URL construction and parsing. Main builds URLs (`toMediaUrl`) when it assembles
 * `ItemSummary` payloads; the protocol handler parses them (`parseMediaUrl`) and resolves the
 * relative path under `<userData>/<root>/`.
 */

import { MEDIA_SCHEME } from './constants'

/** Library directories that may be served over `ka-media://`. */
export const MEDIA_ROOTS = ['objects', 'thumbs', 'snapshots', 'content'] as const

/** One of `MEDIA_ROOTS`. */
export type MediaRoot = (typeof MEDIA_ROOTS)[number]

export interface ParsedMediaUrl {
  root: MediaRoot
  /** Decoded path relative to the root directory, forward slashes, no empty or `..` segments. */
  relPath: string
  /** Cache-busting version (`?v=`); 0 when absent. */
  version: number
}

const HOST = 'local'
const PREFIX = `${MEDIA_SCHEME}://${HOST}/`

export function isMediaRoot(value: unknown): value is MediaRoot {
  return typeof value === 'string' && (MEDIA_ROOTS as readonly string[]).includes(value)
}

/**
 * Build `ka-media://local/<root>/<segments...>?v=<version>`. Each path segment is
 * `encodeURIComponent`-ed; empty segments are dropped. `relPath` must be relative.
 */
export function toMediaUrl(root: MediaRoot, relPath: string, version: number): string {
  const segments = relPath
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
  const v = Number.isFinite(version) && version >= 0 ? Math.floor(version) : 0
  return `${PREFIX}${root}/${segments.join('/')}?v=${v}`
}

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

/**
 * Parse a `ka-media://` URL. Returns null for anything that must not be served: unknown scheme or
 * host, unknown root, empty path, empty / `.` / `..` segments, backslashes, absolute paths, or
 * undecodable escapes.
 */
export function parseMediaUrl(url: string): ParsedMediaUrl | null {
  if (typeof url !== 'string' || !url.startsWith(PREFIX)) return null
  const rest = url.slice(PREFIX.length)

  const hashAt = rest.indexOf('#')
  const withoutHash = hashAt === -1 ? rest : rest.slice(0, hashAt)
  const queryAt = withoutHash.indexOf('?')
  const pathPart = queryAt === -1 ? withoutHash : withoutHash.slice(0, queryAt)
  const query = queryAt === -1 ? '' : withoutHash.slice(queryAt + 1)

  if (pathPart.includes('\\')) return null

  const [rootRaw, ...encodedSegments] = pathPart.split('/')
  if (!isMediaRoot(rootRaw)) return null
  if (encodedSegments.length === 0) return null

  const decoded: string[] = []
  for (const encoded of encodedSegments) {
    const segment = decodeSegment(encoded)
    if (segment === null) return null
    if (segment.length === 0 || segment === '.' || segment === '..') return null
    if (segment.includes('/') || segment.includes('\\') || segment.includes('\0')) return null
    decoded.push(segment)
  }

  let version = 0
  if (query.length > 0) {
    const match = /(?:^|&)v=([^&]*)/.exec(query)
    if (match) {
      const raw = match[1] ?? ''
      if (!/^\d+$/.test(raw)) return null
      version = Number.parseInt(raw, 10)
    }
  }

  return { root: rootRaw, relPath: decoded.join('/'), version }
}
