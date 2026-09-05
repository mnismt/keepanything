import { createHash } from 'node:crypto'
import { createReadStream, mkdirSync, renameSync, type Stats, statSync, writeFileSync } from 'node:fs'
import { access, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
}

/** Synchronous `ensureDir` for bootstrap paths. */
export function ensureDirSync(dir: string): void {
  mkdirSync(dir, { recursive: true })
}

/** True when `path` exists (any kind). */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** Synchronous existence check for hot paths (media protocol, missing-file cache). */
export function pathExistsSync(path: string): boolean {
  try {
    statSync(path)
    return true
  } catch {
    return false
  }
}

/** Maximum length of a generated file name (conservative for APFS and URLs). */
export const MAX_FILENAME_LENGTH = 180

// Control characters (U+0000-U+001F, U+007F) and characters that break paths or URLs.
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the purpose
const UNSAFE_CHARS = /[\u0000-\u001f\u007f/\\:]+/g

/**
 * Turn any string into a file name that is safe on macOS and inside URLs: no path separators,
 * control characters or leading dots, collapsed whitespace, capped length (extension preserved).
 * Falls back to `fallback` when nothing usable remains.
 */
export function safeFilename(name: string, fallback = 'file'): string {
  const base = basename(name.replace(/\\/g, '/'))
  let cleaned = base.replace(UNSAFE_CHARS, ' ').replace(/\s+/g, ' ').trim()
  cleaned = cleaned.replace(/^\.+/, '')
  if (cleaned.length === 0) cleaned = fallback
  if (cleaned.length > MAX_FILENAME_LENGTH) {
    const ext = extname(cleaned)
    const keepExt = ext.length > 0 && ext.length <= 16 ? ext : ''
    cleaned = cleaned.slice(0, MAX_FILENAME_LENGTH - keepExt.length).trimEnd() + keepExt
  }
  return cleaned
}

/** Write `data` to `path` atomically (temp file in the same directory, then rename). */
export async function writeFileAtomic(path: string, data: string | Uint8Array): Promise<void> {
  await ensureDir(dirname(path))
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`)
  try {
    await writeFile(tmp, data)
    await rename(tmp, path)
  } catch (error) {
    await rm(tmp, { force: true })
    throw error
  }
}

/** Synchronous atomic write for small config files during bootstrap/shutdown. */
export function writeFileAtomicSync(path: string, data: string | Uint8Array): void {
  ensureDirSync(dirname(path))
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`)
  writeFileSync(tmp, data)
  renameSync(tmp, path)
}

/** Streaming sha256 (hex) of a file; never loads the whole file into memory. */
export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')))
  })
}

/** sha256 (hex) of in-memory bytes. */
export function sha256Bytes(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** `stat` that returns null instead of throwing for missing paths. */
export async function statOrNull(path: string): Promise<Stats | null> {
  try {
    return await stat(path)
  } catch {
    return null
  }
}
