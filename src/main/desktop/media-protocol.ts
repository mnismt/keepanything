import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { protocol } from 'electron'
import mime from 'mime'
import { MEDIA_SCHEME } from '../../shared/constants'
import { parseMediaUrl } from '../../shared/media'
import type { Logger, Paths } from '../ports'
import { resolveMediaPath } from '../storage/paths'

/** Parsed `Range: bytes=a-b` header, clamped to the file. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null
  const [, startRaw = '', endRaw = ''] = match
  if (startRaw === '' && endRaw === '') return null
  let start = startRaw === '' ? Math.max(0, size - Number(endRaw)) : Number(startRaw)
  let end = endRaw === '' || startRaw === '' ? size - 1 : Number(endRaw)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  start = Math.max(0, start)
  end = Math.min(end, size - 1)
  if (start > end) return null
  return { start, end }
}

/**
 * Serve `ka-media://local/<root>/<path>?v=` from the library directories only:
 * traversal-checked, `Range` (206) for video, immutable caching (the `?v=` bump busts it).
 */
export function registerMediaProtocol(paths: Paths, logger: Logger): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const parsed = parseMediaUrl(request.url)
    const abs = parsed ? resolveMediaPath(paths, parsed) : null
    if (!abs) {
      logger.debug('media request refused', { url: request.url })
      return new Response('Not found', { status: 404 })
    }
    let size: number
    try {
      const stats = await stat(abs)
      if (!stats.isFile()) return new Response('Not found', { status: 404 })
      size = stats.size
    } catch {
      return new Response('Not found', { status: 404 })
    }
    const type = mime.getType(abs) ?? 'application/octet-stream'
    const headers = new Headers({
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=31536000, immutable'
    })
    const range = parseRange(request.headers.get('range'), size)
    if (range) {
      headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
      headers.set('Content-Length', String(range.end - range.start + 1))
      const stream = Readable.toWeb(createReadStream(abs, { start: range.start, end: range.end })) as ReadableStream
      return new Response(stream, { status: 206, headers })
    }
    headers.set('Content-Length', String(size))
    if (request.method === 'HEAD') return new Response(null, { status: 200, headers })
    const stream = Readable.toWeb(createReadStream(abs)) as ReadableStream
    return new Response(stream, { status: 200, headers })
  })
}
