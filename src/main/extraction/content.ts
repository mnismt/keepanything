import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sha256Bytes, writeFileAtomic } from '../lib/fs'
import type { ExtractedContent } from './types'

/**
 * Extracted bodies live next to generated notes in `content/`: `<itemId>.md` when the adapter
 * produced Markdown, `<itemId>.txt` otherwise. Idempotent: the same bytes are never rewritten.
 */

/** What was written (relative to `contentDir`). */
export interface ContentFile {
  path: string
  hash: string
  chars: number
  kind: 'markdown' | 'text'
}

export function contentFileName(itemId: string, kind: 'markdown' | 'text'): string {
  return `${itemId}.${kind === 'markdown' ? 'md' : 'txt'}`
}

/** Write the body when there is one; returns null for empty content. */
export async function writeContentFile(
  contentDir: string,
  itemId: string,
  content: Pick<ExtractedContent, 'text' | 'markdown'>
): Promise<ContentFile | null> {
  const kind: ContentFile['kind'] = content.markdown && content.markdown.trim().length > 0 ? 'markdown' : 'text'
  const body = kind === 'markdown' ? (content.markdown as string) : content.text
  if (body.trim().length === 0) return null
  const name = contentFileName(itemId, kind)
  const abs = join(contentDir, name)
  const hash = sha256Bytes(body)
  const existing = await readFile(abs, 'utf8').catch(() => null)
  if (existing === null || sha256Bytes(existing) !== hash) await writeFileAtomic(abs, body)
  return { path: name, hash, chars: body.length, kind }
}
