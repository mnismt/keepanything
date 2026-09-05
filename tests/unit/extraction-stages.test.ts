import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { silentLogger } from '../../src/main/lib/logger'
import { extractStage } from '../../src/main/pipeline/stages/extract'
import { isProvisionalTitle, snapshotStage } from '../../src/main/pipeline/stages/snapshot'
import { thumbnailStage } from '../../src/main/pipeline/stages/thumbnail'
import type { StageContext, StageDeps } from '../../src/main/ports'
import type { PreviewMaker } from '../../src/main/previews/thumbnails'
import type { Item } from '../../src/shared/types'
import { fetchStub, htmlResponse } from './helpers/fake-item'
import { createHarness, type Harness } from './helpers/harness'

const FIXTURES = resolve(__dirname, '../fixtures/corpus/files')
const ARTICLE = readFileSync(resolve(__dirname, '../fixtures/html/article.html'), 'utf8')

const ctxFor = (h: Harness, item: Item, deps: StageDeps = {}): StageContext => ({
  itemId: item.id,
  item,
  paths: h.paths,
  logger: silentLogger,
  clock: h.clock,
  signal: new AbortController().signal,
  deps
})

/** Copy a fixture into the object store and create the item pointing at it. */
async function fileItem(h: Harness, fixture: string, overrides: Partial<Item>): Promise<Item> {
  const id = `it-${Math.random().toString(36).slice(2, 8)}`
  const stored = await h.objectStore.copyFile(id, resolve(FIXTURES, fixture))
  return h.items.create({
    id,
    type: 'file',
    title: fixture,
    managedPath: stored.managedPath,
    contentHash: stored.sha256,
    size: stored.size,
    metadata: { originalName: fixture.split('/').pop() },
    ...overrides
  })
}

describe('extract stage', () => {
  let h: Harness
  beforeEach(() => {
    h = createHarness({ withFiles: true })
  })
  afterEach(() => h.close())

  it('extracts a PDF twice with identical patches and no duplicate content files', async () => {
    const item = await fileItem(h, 'pagedattention-vllm-2309.06180.pdf', { type: 'pdf' })
    const first = await extractStage.run(ctxFor(h, item))
    expect(first.outcome).toBe('ok')
    expect(first.item?.pageCount).toBeGreaterThan(10)
    expect(first.item?.extractedText).toMatch(/PagedAttention/)
    expect(first.item?.excerpt?.length).toBeLessThanOrEqual(280)
    expect(first.item?.width).toBe(612)
    expect(first.metadataPatch?.content).toMatchObject({ path: `${item.id}.txt`, kind: 'text' })
    expect(first.metadataPatch?.extractor).toBe('pdf')
    const filesAfterFirst = readdirSync(h.paths.contentDir)
    const second = await extractStage.run(ctxFor(h, item))
    expect(second).toEqual(first)
    expect(readdirSync(h.paths.contentDir)).toEqual(filesAfterFirst)
    expect(filesAfterFirst).toEqual([`${item.id}.txt`])
  }, 30_000)

  it('does not duplicate the body of markdown items and keeps user titles', async () => {
    const item = await fileItem(h, 'notes/inference-providers-notes.md', {
      type: 'markdown',
      title: 'My own title',
      userOverrides: { title: true }
    })
    const patch = await extractStage.run(ctxFor(h, item))
    expect(patch.outcome).toBe('ok')
    expect(patch.item?.title).toBeUndefined()
    expect(patch.metadataPatch?.content).toBeNull()
    expect(Array.isArray(patch.metadataPatch?.headings)).toBe(true)
    expect(readdirSync(h.paths.contentDir)).toEqual([])
  })

  it('keeps items whose original is gone as partial, and text items with a body as ok', async () => {
    const item = h.items.create({ type: 'pdf', title: 'gone', originalPath: '/nowhere/x.pdf' })
    const patch = await extractStage.run(ctxFor(h, item))
    expect(patch.outcome).toBe('partial')
    expect(patch.message).toBe("Couldn't read this, but it's kept.")
    const note = h.items.create({ type: 'text', title: 'note', extractedText: 'already here' })
    expect((await extractStage.run(ctxFor(h, note))).outcome).toBe('ok')
  })

  it('extracts a URL through a stubbed fetch, writes the url-cache and replays it offline', async () => {
    const url = 'https://blog.example.com/posts/continuous-batching/'
    const item = h.items.create({
      type: 'url',
      title: 'continuous batching · blog.example.com',
      url,
      canonicalUrl: 'https://blog.example.com/posts/continuous-batching',
      domain: 'blog.example.com'
    })
    const stub = fetchStub({ [url]: () => htmlResponse(ARTICLE) })
    const first = await extractStage.run(ctxFor(h, item, { fetchImpl: stub.fetchImpl }))
    expect(first.outcome).toBe('ok')
    expect(first.item?.title).toBe('Continuous batching for LLM inference')
    expect(first.item?.subtype).toBe('article')
    expect(first.metadataPatch?.content).toMatchObject({ path: `${item.id}.md`, kind: 'markdown' })
    expect(readFileSync(join(h.paths.contentDir, `${item.id}.md`), 'utf8')).toContain('## What we measured')
    expect(readdirSync(h.paths.urlCacheDir)).toHaveLength(1)

    const offline = fetchStub({})
    const second = await extractStage.run(ctxFor(h, item, { fetchImpl: offline.fetchImpl }))
    expect(offline.calls).toEqual([])
    expect(second.item?.title).toBe(first.item?.title)
    expect(second.item?.extractedText).toBe(first.item?.extractedText)
    expect(second.metadataPatch?.fetchedVia).toBe('cache')
  })

  it('marks unreadable pages partial with the product copy and keeps the link', async () => {
    const item = h.items.create({
      type: 'url',
      title: 'x',
      url: 'https://gone.example.com/p',
      canonicalUrl: 'https://gone.example.com/p',
      domain: 'gone.example.com'
    })
    const patch = await extractStage.run(ctxFor(h, item, { fetchImpl: fetchStub({}).fetchImpl }))
    expect(patch.outcome).toBe('partial')
    expect(patch.message).toBe("Couldn't read this page, but the link is safe.")
  })

  it('extracts a folder as one item', async () => {
    const item = h.items.create({
      type: 'folder',
      title: 'bench',
      originalPath: resolve(FIXTURES, 'folder-serving-benchmark')
    })
    const patch = await extractStage.run(ctxFor(h, item))
    expect(patch.outcome).toBe('ok')
    const folder = patch.metadataPatch?.folder as { fileCount: number }
    expect(folder.fileCount).toBe(6)
    expect(patch.item?.extractedText).toContain('run_bench.py')
  })
})

/** A `PreviewMaker` that writes tiny files and reports fixed sizes (no Electron). */
function fakePreviews(): PreviewMaker & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async thumbnail(_file, outPath) {
      calls.push('thumbnail')
      mkdirSync(join(outPath, '..'), { recursive: true })
      writeFileSync(outPath, 'png')
      return { width: 800, height: 500 }
    },
    async visionImage(_file, outPath) {
      calls.push('vision')
      writeFileSync(outPath, 'jpg')
      return { width: 1280, height: 800 }
    },
    async dominantColorOf() {
      return '#123456'
    }
  }
}

describe('thumbnail stage', () => {
  let h: Harness
  beforeEach(() => {
    h = createHarness({ withFiles: true })
  })
  afterEach(() => h.close())

  it('is NOT_IMPLEMENTED without a thumbnailer', async () => {
    const item = await fileItem(h, 'screenshots/terminal-pnpm-test.png', { type: 'image' })
    await expect(thumbnailStage.run(ctxFor(h, item))).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' })
  })

  it('records image dims, subtype, vision image, thumbnail and colour; idempotent', async () => {
    const item = await fileItem(h, 'screenshots/terminal-pnpm-test.png', { type: 'image' })
    const previews = fakePreviews()
    const first = await thumbnailStage.run(ctxFor(h, item, { thumbnailer: previews }))
    expect(first.outcome).toBe('ok')
    expect(first.item).toMatchObject({
      width: 1440,
      height: 900,
      subtype: 'screenshot',
      thumbnailPath: `${item.id}.png`,
      dominantColor: '#123456'
    })
    expect(first.item?.mediaVersion).toBeUndefined()
    expect(first.metadataPatch?.visionImage).toEqual({ path: `${item.id}.vision.jpg`, width: 1280, height: 800 })
    expect(first.metadataPatch?.thumb).toEqual({ width: 800, height: 500 })
    expect(readdirSync(h.paths.thumbsDir)).toEqual([`${item.id}.png`])
    const second = await thumbnailStage.run(ctxFor(h, item, { thumbnailer: previews }))
    expect(second).toEqual(first)
    expect(readdirSync(h.paths.thumbsDir)).toEqual([`${item.id}.png`])
    const regenerated = await thumbnailStage.run(
      ctxFor(h, { ...item, thumbnailPath: `${item.id}.png`, mediaVersion: 3 }, { thumbnailer: previews })
    )
    expect(regenerated.item?.mediaVersion).toBe(4)
  })

  it('uses the thumbnail size as the card size for documents and tolerates no preview', async () => {
    const pdf = await fileItem(h, 'react-reasoning-acting-2210.03629.pdf', { type: 'pdf' })
    const previews = fakePreviews()
    const patch = await thumbnailStage.run(ctxFor(h, pdf, { thumbnailer: previews }))
    expect(patch.item).toMatchObject({ width: 800, height: 500, thumbnailPath: `${pdf.id}.png` })
    expect(previews.calls).toEqual(['thumbnail'])
    const none: PreviewMaker = {
      thumbnail: async () => null,
      visionImage: async () => null,
      dominantColorOf: async () => null
    }
    const missing = await thumbnailStage.run(ctxFor(h, pdf, { thumbnailer: none }))
    expect(missing.outcome).toBe('ok')
    expect(missing.item?.thumbnailPath).toBeUndefined()
    const image = await fileItem(h, 'screenshots/error-dialog-sqlite.png', { type: 'image' })
    expect((await thumbnailStage.run(ctxFor(h, image, { thumbnailer: none }))).outcome).toBe('partial')
  })
})

describe('snapshot stage', () => {
  let h: Harness
  beforeEach(() => {
    h = createHarness({ withFiles: true })
  })
  afterEach(() => h.close())

  it('skips non-url and pdf items, is NOT_IMPLEMENTED without a snapshotter', async () => {
    const text = h.items.create({ type: 'text', title: 't' })
    expect((await snapshotStage.run(ctxFor(h, text))).outcome).toBe('ok')
    const pdfUrl = h.items.create({ type: 'url', title: 'p', url: 'https://x.y/a.pdf', domain: 'x.y' })
    expect((await snapshotStage.run(ctxFor(h, pdfUrl))).metadataPatch).toEqual({ snapshot: { skipped: 'pdf' } })
    const byHeader = h.items.create({
      type: 'url',
      title: 'p',
      url: 'https://x.y/a',
      domain: 'x.y',
      metadata: { urlKind: 'pdf' }
    })
    expect((await snapshotStage.run(ctxFor(h, byHeader))).metadataPatch).toEqual({ snapshot: { skipped: 'pdf' } })
    const page = h.items.create({ type: 'url', title: 'p', url: 'https://x.y/page', domain: 'x.y' })
    await expect(snapshotStage.run(ctxFor(h, page))).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' })
  })

  it('writes the snapshot path, colour, title and bumps media_version on regeneration', async () => {
    const item = h.items.create({ type: 'url', title: 'page · x.y', url: 'https://x.y/page', domain: 'x.y' })
    expect(isProvisionalTitle(item)).toBe(true)
    const calls: string[] = []
    const snapshotter = {
      snapshot: async (url: string, outPath: string) => {
        calls.push(url)
        writeFileSync(outPath, 'png')
        return { width: 1280, height: 800, title: 'Rendered Title', dominantColor: '#abcdef', finalUrl: url }
      },
      dispose: () => undefined
    }
    const patch = await snapshotStage.run(ctxFor(h, item, { snapshotter }))
    expect(patch.outcome).toBe('ok')
    expect(patch.item).toEqual({ snapshotPath: `${item.id}.png`, dominantColor: '#abcdef', title: 'Rendered Title' })
    expect(patch.metadataPatch?.snapshot).toMatchObject({ width: 1280, height: 800, title: 'Rendered Title' })
    expect(readdirSync(h.paths.snapshotsDir)).toEqual([`${item.id}.png`])
    const again = await snapshotStage.run(
      ctxFor(
        h,
        { ...item, title: 'User title', snapshotPath: `${item.id}.png`, dominantColor: '#000000' },
        { snapshotter }
      )
    )
    expect(again.item).toEqual({ snapshotPath: `${item.id}.png`, mediaVersion: 2 })
    const failing = { snapshot: async () => null, dispose: () => undefined }
    expect((await snapshotStage.run(ctxFor(h, item, { snapshotter: failing }))).outcome).toBe('partial')
    expect(calls).toHaveLength(2)
    copyFileSync(join(h.paths.snapshotsDir, `${item.id}.png`), join(h.paths.snapshotsDir, 'copy.png'))
  })
})
