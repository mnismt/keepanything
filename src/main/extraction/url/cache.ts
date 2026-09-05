import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sha256Bytes, writeFileAtomic } from '../../lib/fs'

/**
 * Fetched HTML cached by canonical URL under `url-cache/`, so a retried or reprocessed URL item
 * extracts offline and demos replay deterministically. One JSON file per canonical URL.
 */
export interface UrlCacheEntry {
  url: string
  finalUrl: string
  status: number
  contentType: string
  html: string
  fetchedAt: string
  via: 'fetch' | 'dom'
}

export function urlCachePath(dir: string, canonical: string): string {
  return join(dir, `${sha256Bytes(canonical)}.json`)
}

/** Read a cached page; null when absent or unreadable. */
export async function readUrlCache(dir: string | undefined, canonical: string): Promise<UrlCacheEntry | null> {
  if (!dir) return null
  try {
    const raw = await readFile(urlCachePath(dir, canonical), 'utf8')
    const parsed = JSON.parse(raw) as Partial<UrlCacheEntry>
    if (typeof parsed.html !== 'string' || typeof parsed.finalUrl !== 'string') return null
    return {
      url: parsed.url ?? canonical,
      finalUrl: parsed.finalUrl,
      status: typeof parsed.status === 'number' ? parsed.status : 200,
      contentType: parsed.contentType ?? 'text/html',
      html: parsed.html,
      fetchedAt: parsed.fetchedAt ?? '',
      via: parsed.via === 'dom' ? 'dom' : 'fetch'
    }
  } catch {
    return null
  }
}

/** Write a cached page (best effort; failures are swallowed by the caller's logger). */
export async function writeUrlCache(dir: string | undefined, canonical: string, entry: UrlCacheEntry): Promise<void> {
  if (!dir) return
  await writeFileAtomic(urlCachePath(dir, canonical), JSON.stringify(entry))
}
