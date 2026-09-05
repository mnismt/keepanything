/**
 * Extraction probe (bundled by `extract-probe.mjs`): runs the slice-3 adapters against the demo
 * fixtures without Electron and prints title / excerpt / page counts / sizes. Network adapters run
 * only with `--online` (real GitHub / arXiv / YouTube requests, no key needed).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { scanFolder } from '../../src/main/capture/folder'
import { canonicalizeUrl } from '../../src/main/capture/url'
import { extractItem } from '../../src/main/extraction/registry'
import type { ExtractedContent } from '../../src/main/extraction/types'
import { analyzeHtml } from '../../src/main/extraction/url/readable'
import { createManualClock } from '../../src/main/lib/clock'
import { silentLogger } from '../../src/main/lib/logger'
import type { Item } from '../../src/shared/types'

const ROOT = resolve(process.env.KEEPANYTHING_PROBE_ROOT ?? process.cwd())
const FIXTURES = resolve(ROOT, 'tests/fixtures/corpus/files')
const online = process.argv.includes('--online')

function item(overrides: Partial<Item>): Item {
  return {
    id: 'probe',
    type: 'file',
    subtype: null,
    kind: null,
    title: 'probe',
    originalPath: null,
    managedPath: null,
    url: null,
    canonicalUrl: null,
    domain: null,
    mimeType: null,
    size: null,
    contentHash: null,
    width: null,
    height: null,
    durationMs: null,
    pageCount: null,
    createdAt: '',
    capturedAt: '',
    modifiedAt: '',
    lastKeptAt: '',
    captureBatchId: null,
    processingStatus: 'CAPTURED',
    processingError: null,
    understanding: null,
    whyUseful: null,
    topics: [],
    entities: [],
    visionText: null,
    retrievalHints: [],
    aiConfidence: null,
    metadata: {},
    extractedText: null,
    excerpt: null,
    thumbnailPath: null,
    snapshotPath: null,
    faviconPath: null,
    dominantColor: null,
    mediaVersion: 1,
    parentItemId: null,
    userOverrides: {},
    isMissing: false,
    missingCheckedAt: null,
    deletedAt: null,
    ...overrides
  }
}

const deps = { logger: silentLogger, clock: createManualClock() }

function report(label: string, out: ExtractedContent, ms: number): void {
  const excerpt = typeof out.meta.excerpt === 'string' ? out.meta.excerpt : out.text.slice(0, 160)
  const lines = [
    `\n## ${label}  (${ms} ms, adapter=${String(out.meta.extractor)})`,
    `title:    ${out.title ?? '(kept capture title)'}`,
    `subtype:  ${out.item?.subtype ?? '-'}   pages: ${out.pageCount ?? '-'}   dims: ${out.dims ? `${out.dims.width}×${out.dims.height}` : '-'}`,
    `text:     ${out.text.length} chars${out.truncated ? ' (truncated)' : ''}${out.markdown ? `, markdown ${out.markdown.length} chars` : ''}${out.partial ? `, PARTIAL: ${out.error}` : ''}`,
    `excerpt:  ${excerpt.replace(/\s+/g, ' ').slice(0, 200)}`
  ]
  process.stdout.write(`${lines.join('\n')}\n`)
}

async function run(label: string, it: Item, filePath: string | null): Promise<void> {
  const started = Date.now()
  try {
    const out = await extractItem({ item: it, filePath }, deps)
    report(label, out, Date.now() - started)
  } catch (error) {
    process.stdout.write(`\n## ${label}\nFAILED: ${error instanceof Error ? error.message : String(error)}\n`)
  }
}

async function main(): Promise<void> {
  const files: [string, Partial<Item>][] = [
    ['pagedattention-vllm-2309.06180.pdf', { type: 'pdf' }],
    ['react-reasoning-acting-2210.03629.pdf', { type: 'pdf' }],
    ['notes/inference-providers-notes.md', { type: 'markdown' }],
    ['notes/weekly-review-2026-08-28.md', { type: 'markdown' }],
    ['snippets/hyperliquid-snippet.txt', { type: 'text' }],
    ['screenshots/pricing-page-inference.png', { type: 'image' }],
    ['folder-serving-benchmark/results.csv', { type: 'file', subtype: 'spreadsheet' }],
    ['folder-serving-benchmark/run_bench.py', { type: 'file', subtype: 'code' }]
  ]
  for (const [rel, overrides] of files) {
    const path = resolve(FIXTURES, rel)
    await run(rel, item({ ...overrides, metadata: { originalName: rel.split('/').pop() } }), path)
  }
  const folder = resolve(FIXTURES, 'folder-serving-benchmark')
  const scan = await scanFolder(folder)
  process.stdout.write(
    `\nfolder scan: ${scan.fileCount} files, ${scan.totalBytes} bytes, ext=${JSON.stringify(scan.extensions)}\n`
  )
  await run(
    'folder-serving-benchmark/',
    item({ type: 'folder', originalPath: folder, title: 'folder-serving-benchmark' }),
    null
  )

  const article = readFileSync(resolve(ROOT, 'tests/fixtures/html/article.html'), 'utf8')
  const started = Date.now()
  const analysis = await analyzeHtml(article, 'https://blog.example.com/posts/continuous-batching/')
  process.stdout.write(
    `\n## article.html (offline readability, ${Date.now() - started} ms)\ntitle: ${analysis.metadata.title}\nreadable: ${analysis.readable?.length} chars, markdown ${analysis.readable?.markdown.length} chars\n`
  )

  if (online) {
    const urls = readFileSync(resolve(FIXTURES, 'urls.txt'), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'))
    for (const url of urls) {
      const c = canonicalizeUrl(url)
      await run(
        url,
        item({ type: 'url', url, canonicalUrl: c?.canonical ?? url, domain: c?.domain ?? null, title: url }),
        null
      )
    }
  } else {
    process.stdout.write('\n(pass --online to also probe the URLs in tests/fixtures/corpus/files/urls.txt)\n')
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  process.exit(1)
})
