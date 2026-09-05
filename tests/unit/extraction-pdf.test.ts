import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pdfExtractor, pdfToContent, plausiblePdfTitle } from '../../src/main/extraction/pdf'
import { extractPdfFile, joinTextItems, pdfDateToIso } from '../../src/main/extraction/pdf-core'
import { createManualClock } from '../../src/main/lib/clock'
import { silentLogger } from '../../src/main/lib/logger'
import { fakeItem } from './helpers/fake-item'

const FIXTURES = resolve(__dirname, '../fixtures/corpus/files')
const REACT = resolve(FIXTURES, 'react-reasoning-acting-2210.03629.pdf')
const PAGED = resolve(FIXTURES, 'pagedattention-vllm-2309.06180.pdf')
const deps = { logger: silentLogger, clock: createManualClock() }

describe('pdf core', () => {
  it('normalises PDF dates and joins text items', () => {
    expect(pdfDateToIso('D:20230313000911Z')).toBe('2023-03-13T00:09:11.000Z')
    expect(pdfDateToIso("D:20230313010911+01'00'")).toBe('2023-03-13T00:09:11.000Z')
    expect(pdfDateToIso('garbage')).toBeUndefined()
    expect(joinTextItems([{ str: 'Hello' }, { str: 'world', hasEOL: true }, { str: 'next' }])).toBe('Hello world\nnext')
    expect(joinTextItems([{ str: 'hyphen-', hasEOL: true }, { str: 'ated' }])).toBe('hyphenated')
  })

  it('reads the ReAct paper: pages, text, page size, info', async () => {
    const out = await extractPdfFile(REACT, { maxPages: 5 })
    expect(out.pageCount).toBe(33)
    expect(out.pagesRead).toBe(5)
    expect(out.truncated).toBe(true)
    expect(out.pageSize).toEqual({ width: 612, height: 792 })
    expect(out.firstPageText).toMatch(/Published as a conference paper at ICLR 2023/)
    expect(out.text).toMatch(/REAC\s?T/i)
    expect(out.info.createdAt).toMatch(/^2023-/)
  })

  it('stops at the character budget', async () => {
    const out = await extractPdfFile(PAGED, { maxChars: 3000 })
    expect(out.text.length).toBeLessThanOrEqual(3000)
    expect(out.truncated).toBe(true)
    expect(out.pageCount).toBeGreaterThan(10)
  })

  it('judges PDF titles and shapes content', () => {
    expect(plausiblePdfTitle('main.pdf', 'main.pdf')).toBe(false)
    expect(plausiblePdfTitle('Untitled', 'a.pdf')).toBe(false)
    expect(plausiblePdfTitle('paper', 'paper.pdf')).toBe(false)
    expect(plausiblePdfTitle('Efficient Memory Management for LLM Serving', 'x.pdf')).toBe(true)
    const content = pdfToContent(
      {
        pageCount: 2,
        text: 'Body text here.',
        firstPageText: 'A Real Title Line\nBody text here.',
        pagesRead: 2,
        truncated: false,
        pageSize: { width: 100, height: 200 },
        info: { author: 'Ann' }
      },
      'x.pdf'
    )
    expect(content.pageCount).toBe(2)
    expect(content.dims).toEqual({ width: 100, height: 200 })
    expect(content.meta.byline).toBe('Ann')
    expect(content.meta.firstLine).toBe('A Real Title Line')
    expect(content.title).toBeUndefined()
    const empty = pdfToContent(
      { pageCount: 1, text: '', firstPageText: '', pagesRead: 1, truncated: false, pageSize: null, info: {} },
      'scan.pdf'
    )
    expect(empty.partial).toBe(true)
  })

  it('runs the adapter in-process when no worker is available', async () => {
    const out = await pdfExtractor.extract(
      { item: fakeItem({ type: 'pdf', metadata: { originalName: 'pagedattention.pdf' } }), filePath: PAGED },
      deps
    )
    expect(out.pageCount).toBeGreaterThan(10)
    expect(out.text).toMatch(/PagedAttention/)
    expect(out.meta.excerpt).toBeTruthy()
    expect((out.meta.pdf as { pageSize: unknown }).pageSize).toEqual({ width: 612, height: 792 })
  })

  it('uses the worker when present and falls back only on NOT_IMPLEMENTED', async () => {
    const calls: string[] = []
    const worker = {
      call: async <T>(task: string): Promise<T> => {
        calls.push(task)
        return {
          pageCount: 1,
          text: 'from worker',
          firstPageText: 'from worker',
          pagesRead: 1,
          truncated: false,
          pageSize: null,
          info: {}
        } as T
      },
      terminate: () => undefined
    }
    const out = await pdfExtractor.extract({ item: fakeItem({ type: 'pdf' }), filePath: REACT }, { ...deps, worker })
    expect(calls).toEqual(['extract.pdf'])
    expect(out.text).toBe('from worker')
    const crashing = {
      call: async (): Promise<never> => {
        throw new Error('worker crashed')
      },
      terminate: () => undefined
    }
    await expect(
      pdfExtractor.extract({ item: fakeItem({ type: 'pdf' }), filePath: REACT }, { ...deps, worker: crashing })
    ).rejects.toThrow('worker crashed')
  })
})
