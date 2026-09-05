import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { LIMITS } from '../../shared/constants'
import { listingToContent, listZip, readZipEntry, xmlToText } from './archive'
import { EXTRACTION_BUDGET, type ExtractedContent, type Extractor, squash } from './types'

/**
 * Tabular files: CSV/TSV header + first rows as text; xlsx sheet names (+ first sheet's shared
 * strings as a text sample); other spreadsheet containers are listed only.
 */

const MAX_ROWS = 50
const MAX_BYTES = 512 * 1024

export function detectDelimiter(header: string): ',' | '\t' | ';' | '|' {
  const counts: [',' | '\t' | ';' | '|', number][] = [
    [',', (header.match(/,/g) ?? []).length],
    ['\t', (header.match(/\t/g) ?? []).length],
    [';', (header.match(/;/g) ?? []).length],
    ['|', (header.match(/\|/g) ?? []).length]
  ]
  counts.sort((a, b) => b[1] - a[1])
  return counts[0]?.[1] ? counts[0][0] : ','
}

/** Split one CSV line honouring double quotes. */
export function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"'
        i += 1
      } else quoted = !quoted
    } else if (ch === delimiter && !quoted) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map((c) => c.trim())
}

/** CSV/TSV -> header, sample rows, estimated row count. */
export function extractDelimited(raw: string, fileName: string): ExtractedContent {
  const lines = raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l) => l.trim().length > 0)
  const header = lines[0] ?? ''
  const delimiter = detectDelimiter(header)
  const columns = splitCsvLine(header, delimiter)
  const rows = lines.slice(1, 1 + MAX_ROWS).map((l) => splitCsvLine(l, delimiter))
  const text = [
    `Table: ${fileName}`,
    `Columns: ${columns.join(', ')}`,
    ...rows.map((r) => columns.map((c, i) => `${c}: ${r[i] ?? ''}`).join(' · '))
  ].join('\n')
  return {
    text: text.slice(0, EXTRACTION_BUDGET.maxChars),
    meta: {
      table: {
        columns: columns.slice(0, 64),
        rowCount: Math.max(0, lines.length - 1),
        delimiter: delimiter === '\t' ? 'tab' : delimiter,
        sampledRows: rows.length
      },
      excerpt: squash(`${columns.join(', ')} — ${lines.length - 1} rows`, LIMITS.excerptChars)
    },
    truncated: lines.length - 1 > MAX_ROWS || text.length > EXTRACTION_BUDGET.maxChars
  }
}

export const spreadsheetExtractor: Extractor = {
  id: 'spreadsheet',
  async extract({ item, filePath }) {
    if (!filePath) throw new Error('No spreadsheet to read')
    const name = item.metadata.originalName ?? basename(filePath)
    const ext = extname(name).slice(1).toLowerCase()
    if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
      const bytes = await readFile(filePath)
      const truncatedFile = bytes.byteLength > MAX_BYTES
      const raw = bytes.subarray(0, MAX_BYTES).toString('utf8')
      const out = extractDelimited(raw, name)
      if (truncatedFile) out.truncated = true
      return out
    }
    if (ext === 'xlsx' || ext === 'xlsm') {
      const listing = await listZip(filePath).catch(() => null)
      if (!listing)
        return {
          text: '',
          meta: { table: { format: ext } },
          truncated: false,
          partial: true,
          error: 'Not a zip container'
        }
      const decoder = new TextDecoder('utf-8')
      const workbook = await readZipEntry(filePath, 'xl/workbook.xml')
      const sheets = workbook
        ? [...decoder.decode(workbook).matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) => m[1] ?? '').filter(Boolean)
        : []
      const shared = await readZipEntry(filePath, 'xl/sharedStrings.xml', 4_000_000)
      const strings = shared ? xmlToText(decoder.decode(shared), ['si']).split('\n').filter(Boolean).slice(0, 400) : []
      const text = [`Workbook: ${name}`, sheets.length > 0 ? `Sheets: ${sheets.join(', ')}` : '', ...strings]
        .filter(Boolean)
        .join('\n')
      return {
        text: text.slice(0, EXTRACTION_BUDGET.maxChars),
        meta: {
          table: { format: ext, sheets: sheets.slice(0, 50), sharedStrings: strings.length },
          excerpt: squash(
            [sheets.join(', '), strings.slice(0, 20).join(' · ')].filter(Boolean).join(' — '),
            LIMITS.excerptChars
          )
        },
        truncated: text.length > EXTRACTION_BUDGET.maxChars,
        partial: strings.length === 0
      }
    }
    const listing = await listZip(filePath).catch(() => null)
    if (listing && listing.entries.length > 0) {
      const out = listingToContent(listing, name)
      out.partial = true
      return out
    }
    return {
      text: '',
      meta: { table: { format: ext } },
      truncated: false,
      partial: true,
      error: 'Unsupported spreadsheet format'
    }
  }
}
