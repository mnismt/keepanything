import { basename, extname } from 'node:path'
import type { Item } from '../../shared/types'
import { archiveExtractor, archiveFormat, officeExtractor } from './archive'
import { folderExtractor } from './folder'
import { imageExtractor, readHeader } from './image'
import { parseImageInfo, sniffPdf } from './image-dims'
import { pdfExtractor } from './pdf'
import { spreadsheetExtractor } from './spreadsheet'
import { looksTextual, textExtractor } from './text'
import type { ExtractedContent, ExtractionDeps, ExtractionSource, Extractor } from './types'
import { urlExtractor } from './url'

/**
 * Adapter selection by item type / subtype / extension, with a byte sniff for `file`/`unknown`
 * items whose extension says nothing. `extractItem` is what the `extract` stage calls.
 */

const OFFICE_EXT = new Set(['docx', 'pptx', 'odt', 'odp', 'ods'])
const SHEET_EXT = new Set(['csv', 'tsv', 'xlsx', 'xlsm', 'numbers', 'ods'])
const CODE_LIKE_EXT = new Set([
  'json',
  'jsonl',
  'xml',
  'yaml',
  'yml',
  'toml',
  'ini',
  'cfg',
  'conf',
  'plist',
  'log',
  'rst',
  'tex',
  'bib',
  'sql',
  'graphql',
  'proto',
  'env'
])

/** Metadata-only adapter for things we store but cannot read (video, audio, unknown binaries). */
export const opaqueExtractor: Extractor = {
  id: 'opaque',
  async extract({ item, filePath }): Promise<ExtractedContent> {
    const name = item.metadata.originalName ?? (filePath ? basename(filePath) : item.title)
    return {
      text: '',
      meta: { opaque: true, extension: extname(name).slice(1).toLowerCase() || null },
      truncated: false,
      partial: true,
      error: `No text extractor for ${item.mimeType ?? (extname(name) || 'this file')}`
    }
  }
}

/** Pick the adapter. `filePath` is the managed copy or the original. */
export async function extractorFor(item: Item, filePath: string | null): Promise<Extractor> {
  switch (item.type) {
    case 'url':
      return urlExtractor
    case 'folder':
      return folderExtractor
    case 'pdf':
      return pdfExtractor
    case 'text':
    case 'markdown':
      return textExtractor
    case 'image':
      return imageExtractor
    case 'note':
      return textExtractor
    case 'video':
    case 'audio':
      return opaqueExtractor
    case 'file':
    case 'unknown':
      break
  }
  const name = item.metadata.originalName ?? (filePath ? basename(filePath) : item.title)
  const ext = extname(name).slice(1).toLowerCase()
  if (OFFICE_EXT.has(ext) && !SHEET_EXT.has(ext)) return officeExtractor
  if (SHEET_EXT.has(ext)) return spreadsheetExtractor
  if (item.subtype === 'archive' || archiveFormat(name) !== 'other') return archiveExtractor
  if (item.subtype === 'code' || CODE_LIKE_EXT.has(ext)) return textExtractor
  if (filePath) {
    // Extension said nothing useful: look at the bytes.
    const header = await readHeader(filePath, 16 * 1024).catch(() => null)
    if (header) {
      if (sniffPdf(header)) return pdfExtractor
      if (parseImageInfo(header)) return imageExtractor
      if (header.length > 0 && looksTextual(header)) return textExtractor
    }
  }
  return opaqueExtractor
}

export async function extractItem(source: ExtractionSource, deps: ExtractionDeps): Promise<ExtractedContent> {
  const extractor = await extractorFor(source.item, source.filePath)
  deps.logger.debug('extracting', { itemId: source.item.id, adapter: extractor.id })
  const result = await extractor.extract(source, deps)
  result.meta.extractor = extractor.id
  return result
}
