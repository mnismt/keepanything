import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { LIMITS } from '../../shared/constants'
import { type FolderScan, folderMetadataFrom, renderTree, scanFolder } from '../capture/folder'
import { looksTextual, markdownToText } from './text'
import { EXTRACTION_BUDGET, type ExtractedContent, type Extractor, squash } from './types'

/**
 * Folder adapter: bounded scan -> tree, README head and a sample of small text files so the
 * folder task can describe the project without opening everything.
 */

const TEXT_EXT = new Set([
  'md',
  'markdown',
  'txt',
  'text',
  'rst',
  'json',
  'jsonl',
  'yaml',
  'yml',
  'toml',
  'csv',
  'tsv',
  'ini',
  'cfg',
  'conf',
  'py',
  'js',
  'ts',
  'tsx',
  'jsx',
  'go',
  'rs',
  'java',
  'kt',
  'swift',
  'rb',
  'sh',
  'sql',
  'html',
  'css',
  'xml',
  'tex',
  'bib',
  ''
])

/** Pick the README and the most informative small text files. */
export function chooseSamples(
  scan: FolderScan,
  max = LIMITS.folderSampleFiles
): { readme: string | null; samples: string[] } {
  const readme =
    scan.files.find((f) => /^readme(\.|$)/i.test(basename(f.rel)) && f.depth === 0)?.rel ??
    scan.files.find((f) => /^readme(\.|$)/i.test(basename(f.rel)))?.rel ??
    null
  const candidates = scan.files
    .filter((f) => f.rel !== readme && f.size > 0 && f.size <= LIMITS.folderSampleFileBytes && TEXT_EXT.has(f.ext))
    .filter((f) => !/(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|poetry\.lock)$/.test(f.rel))
    .sort((a, b) => a.depth - b.depth || rank(a.ext) - rank(b.ext) || a.rel.localeCompare(b.rel))
  return { readme, samples: candidates.slice(0, max).map((f) => f.rel) }
}

function rank(ext: string): number {
  if (ext === 'md' || ext === 'markdown' || ext === 'txt' || ext === 'rst') return 0
  if (ext === 'yaml' || ext === 'yml' || ext === 'toml' || ext === 'json') return 1
  return 2
}

async function readSample(root: string, rel: string, maxBytes: number): Promise<string | null> {
  try {
    const bytes = new Uint8Array(await readFile(join(root, rel)))
    if (!looksTextual(bytes)) return null
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, maxBytes))
  } catch {
    return null
  }
}

export const folderExtractor: Extractor = {
  id: 'folder',
  async extract({ item }, deps) {
    const root = item.originalPath
    if (!root) throw new Error('Folder item without a path')
    const scan = await scanFolder(root, deps.signal ? { signal: deps.signal } : {})
    const { readme, samples } = chooseSamples(scan)
    const tree = renderTree(scan, basename(root))
    const sections: string[] = [`Folder: ${basename(root)}`, tree]
    let budget = EXTRACTION_BUDGET.maxChars - tree.length - 200
    let readmeText = ''
    if (readme) {
      const text = await readSample(root, readme, 16_000)
      if (text) {
        readmeText = text
        const slice = text.slice(0, Math.min(8_000, Math.max(0, budget)))
        sections.push(`--- ${readme} ---\n${slice}`)
        budget -= slice.length
      }
    }
    const sampled: string[] = []
    for (const rel of samples) {
      if (budget < 400) break
      const text = await readSample(root, rel, LIMITS.folderSampleFileBytes)
      if (!text) continue
      const slice = text.slice(0, Math.min(3_000, budget))
      sections.push(`--- ${rel} ---\n${slice}`)
      budget -= slice.length + rel.length + 10
      sampled.push(rel)
    }
    const text = sections.join('\n\n')
    const folder = folderMetadataFrom(scan, { sampledFiles: readme ? [readme, ...sampled] : sampled, tree })
    const meta: Record<string, unknown> = { folder, topLevel: scan.topLevel }
    const summary = readmeText ? squash(markdownToText(readmeText), LIMITS.excerptChars) : ''
    meta.excerpt =
      summary ||
      squash(`${scan.fileCount} files · ${Object.keys(scan.extensions).slice(0, 5).join(', ')}`, LIMITS.excerptChars)
    if (summary) meta.description = squash(markdownToText(readmeText), 500)
    const out: ExtractedContent = {
      text: text.slice(0, EXTRACTION_BUDGET.maxChars),
      meta,
      truncated: scan.truncated || text.length > EXTRACTION_BUDGET.maxChars
    }
    if (readmeText) {
      out.markdown = readmeText.slice(0, EXTRACTION_BUDGET.contentFileChars)
      const heading = /^\s{0,3}#\s+(.+)$/m.exec(readmeText)?.[1]?.trim()
      if (
        heading &&
        heading.length >= 3 &&
        heading.length <= 120 &&
        heading.toLowerCase() !== basename(root).toLowerCase()
      )
        meta.readmeTitle = heading
    }
    if (scan.fileCount === 0) {
      out.partial = true
      out.error = 'Empty folder'
    }
    return out
  }
}
