import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  deriveTitle,
  extractTextContent,
  guessLanguage,
  looksTextual,
  markdownHeadings,
  markdownToText,
  parseFrontMatter,
  textExtractor
} from '../../src/main/extraction/text'
import { createManualClock } from '../../src/main/lib/clock'
import { silentLogger } from '../../src/main/lib/logger'
import type { Item } from '../../src/shared/types'

const FIXTURES = resolve(__dirname, '../fixtures/corpus/files')

const item = (overrides: Partial<Item>): Item =>
  ({
    id: 'i1',
    type: 'markdown',
    subtype: null,
    kind: null,
    title: 'x',
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
    suggestedActions: [],
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
  }) as Item

const deps = { logger: silentLogger, clock: createManualClock() }

describe('text helpers', () => {
  it('parses front matter, headings and derives titles', () => {
    const fm = parseFrontMatter('---\ntitle: "Weekly review"\ntags: a, b\n---\n# Heading\nbody')
    expect(fm.data).toEqual({ title: 'Weekly review', tags: 'a, b' })
    expect(fm.body.startsWith('# Heading')).toBe(true)
    expect(markdownHeadings('# One\n\n```\n# not a heading\n```\n## Two ##\ntext')).toEqual(['One', 'Two'])
    expect(deriveTitle('# Inference notes\n\nbody')).toBe('Inference notes')
    expect(deriveTitle('---\ntitle: From FM\n---\n# Other')).toBe('From FM')
    expect(deriveTitle('just a short line\nmore')).toBe('just a short line')
    const long = `${'This is the first sentence of a very long paragraph that goes on. '.repeat(1)}${'And more words. '.repeat(20)}`
    expect(deriveTitle(long)).toBe('This is the first sentence of a very long paragraph that goes on.')
    expect(deriveTitle('   \n\n', 'Fallback')).toBe('Fallback')
  })

  it('guesses languages and detects binary content', () => {
    expect(guessLanguage('run_bench.py')).toBe('Python')
    expect(guessLanguage('Dockerfile')).toBe('Dockerfile')
    expect(guessLanguage('x/Makefile')).toBe('Makefile')
    expect(guessLanguage('photo.raw')).toBeNull()
    expect(looksTextual(new TextEncoder().encode('hello\nworld'))).toBe(true)
    expect(looksTextual(new Uint8Array([0x89, 0x50, 0x00, 0x47]))).toBe(false)
  })

  it('strips markdown to text', () => {
    expect(markdownToText('# T\n\n- a [link](http://x) `code` **bold**\n\n![img](a.png)')).toBe(
      'T\n\na link code bold\n\nimg'
    )
  })

  it('extracts markdown content with headings and excerpt', () => {
    const out = extractTextContent('# Providers\n\nSome **notes** here.\n\n## Costs\n\n- one\n- two', {
      kind: 'markdown'
    })
    expect(out.title).toBe('Providers')
    expect(out.meta.headings).toEqual(['Providers', 'Costs'])
    expect(out.markdown).toContain('## Costs')
    expect(out.text).not.toContain('**')
    expect(out.meta.excerpt).toBe('Providers Some notes here. Costs one two')
    expect(out.truncated).toBe(false)
  })

  it('extracts code with a language guess', () => {
    const out = extractTextContent('import os\nprint(1)\n', { kind: 'code', fileName: 'a.py' })
    expect(out.meta.language).toBe('Python')
    expect(out.meta.lines).toBe(3)
    expect(out.title).toBeUndefined()
  })

  it('runs the file adapter over the demo notes', async () => {
    const filePath = resolve(FIXTURES, 'notes/inference-providers-notes.md')
    const out = await textExtractor.extract(
      { item: item({ type: 'markdown', metadata: { originalName: 'inference-providers-notes.md' } }), filePath },
      deps
    )
    expect(out.text.length).toBeGreaterThan(200)
    expect(out.title).toBeTruthy()
    expect(Array.isArray(out.meta.headings)).toBe(true)
    const code = await textExtractor.extract(
      {
        item: item({ type: 'file', subtype: 'code', metadata: { originalName: 'run_bench.py' } }),
        filePath: resolve(FIXTURES, 'folder-serving-benchmark/run_bench.py')
      },
      deps
    )
    expect(code.meta.language).toBe('Python')
  })
})
