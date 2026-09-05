import { extname, resolve } from 'node:path'
import { TEMP_PATH_MARKERS } from '../../shared/constants'
import type { FileSubtype, Item, ItemType } from '../../shared/types'
import { isScreenshotName } from '../extraction/image'
import { parseImageInfo, sniffPdf } from '../extraction/image-dims'

/**
 * File classification at capture time: item type + subtype from mime/extension, magic-byte sniff
 * for images and PDFs when the extension is missing or lies, temp-path detection.
 */

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'avif', 'bmp', 'tiff', 'tif', 'svg'])
const VIDEO_EXT = new Set(['mp4', 'mov', 'webm', 'm4v', 'mkv', 'avi'])
const AUDIO_EXT = new Set(['mp3', 'm4a', 'wav', 'aac', 'ogg', 'flac', 'aiff'])
const DOC_EXT = new Set(['doc', 'docx', 'rtf', 'pages', 'odt', 'epub'])
const SHEET_EXT = new Set(['xls', 'xlsx', 'xlsm', 'csv', 'numbers', 'ods', 'tsv'])
const SLIDES_EXT = new Set(['ppt', 'pptx', 'key', 'odp'])
const ARCHIVE_EXT = new Set(['zip', 'tar', 'gz', 'tgz', 'bz2', '7z', 'rar', 'dmg', 'xz', 'jar'])
const CODE_EXT = new Set([
  'js',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'jsx',
  'py',
  'go',
  'rs',
  'java',
  'c',
  'cpp',
  'cc',
  'h',
  'hpp',
  'cs',
  'swift',
  'rb',
  'sh',
  'bash',
  'zsh',
  'css',
  'scss',
  'html',
  'php',
  'kt',
  'm',
  'sql',
  'lua',
  'r',
  'scala',
  'dart',
  'vue',
  'svelte'
])
const DATA_EXT = new Set([
  'json',
  'jsonl',
  'xml',
  'yaml',
  'yml',
  'toml',
  'sqlite',
  'db',
  'parquet',
  'plist',
  'ini',
  'log'
])

export function classifyFile(name: string, mimeType: string | null): { type: ItemType; subtype: Item['subtype'] } {
  const ext = extname(name).slice(1).toLowerCase()
  if (mimeType?.startsWith('image/') || IMAGE_EXT.has(ext)) {
    return { type: 'image', subtype: isScreenshotName(name) ? 'screenshot' : null }
  }
  if (mimeType?.startsWith('video/') || VIDEO_EXT.has(ext)) return { type: 'video', subtype: null }
  if (mimeType?.startsWith('audio/') || AUDIO_EXT.has(ext)) return { type: 'audio', subtype: null }
  if (mimeType === 'application/pdf' || ext === 'pdf') return { type: 'pdf', subtype: null }
  if (mimeType === 'text/markdown' || ext === 'md' || ext === 'markdown' || ext === 'mdx')
    return { type: 'markdown', subtype: null }
  if (mimeType === 'text/plain' || ext === 'txt' || ext === 'text') return { type: 'text', subtype: null }
  let subtype: FileSubtype = 'other'
  if (DOC_EXT.has(ext)) subtype = 'document'
  else if (SHEET_EXT.has(ext)) subtype = 'spreadsheet'
  else if (SLIDES_EXT.has(ext)) subtype = 'presentation'
  else if (ARCHIVE_EXT.has(ext)) subtype = 'archive'
  else if (CODE_EXT.has(ext)) subtype = 'code'
  else if (DATA_EXT.has(ext)) subtype = 'data'
  if (!mimeType && ext.length === 0) return { type: 'unknown', subtype: null }
  return { type: 'file', subtype }
}

/** Images and PDFs are recognised regardless of extension. */
export function classifyBytes(header: Uint8Array): { type: ItemType; mimeType: string } | null {
  if (sniffPdf(header)) return { type: 'pdf', mimeType: 'application/pdf' }
  const image = parseImageInfo(header)
  if (image) {
    const mime =
      image.format === 'svg' ? 'image/svg+xml' : image.format === 'jpeg' ? 'image/jpeg' : `image/${image.format}`
    return { type: 'image', mimeType: mime }
  }
  return null
}

/** True when `path` is inside a macOS temporary location (must be copied, never referenced). */
export function isTempPath(path: string, tmpDir: string): boolean {
  const normalized = resolve(path)
  return normalized.startsWith(resolve(tmpDir)) || TEMP_PATH_MARKERS.some((marker) => normalized.includes(marker))
}

export { isScreenshotName }
