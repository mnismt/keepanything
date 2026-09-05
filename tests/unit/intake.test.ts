import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  canonicalizeUrl,
  classifyFile,
  createIntake,
  guessUrlSubtype,
  isMediaUrl,
  isTempPath,
  parseUriList
} from '../../src/main/capture/intake'
import { silentLogger } from '../../src/main/lib/logger'
import type { Intake } from '../../src/main/ports'
import type { Settings } from '../../src/shared/types'
import { createHarness, type Harness } from './helpers/harness'

const settings: Settings = {
  aiMode: 'mock',
  model: 'm',
  baseUrl: 'https://x',
  hasApiKey: false,
  apiKeyMasked: null,
  importMode: 'copy',
  theme: 'system',
  libraryPath: '/tmp',
  embeddings: { provider: 'none', modelPresent: false, dims: 384 }
}

describe('intake helpers', () => {
  it('classifies files by mime and extension', () => {
    expect(classifyFile('Screenshot 2026-08-14 at 10.02.11.png', 'image/png')).toEqual({
      type: 'image',
      subtype: 'screenshot'
    })
    expect(classifyFile('photo.heic', 'image/heic')).toEqual({ type: 'image', subtype: null })
    expect(classifyFile('paper.pdf', 'application/pdf')).toEqual({ type: 'pdf', subtype: null })
    expect(classifyFile('notes.md', 'text/markdown')).toEqual({ type: 'markdown', subtype: null })
    expect(classifyFile('notes.txt', 'text/plain')).toEqual({ type: 'text', subtype: null })
    expect(classifyFile('deck.key', null)).toEqual({ type: 'file', subtype: 'presentation' })
    expect(classifyFile('data.json', 'application/json')).toEqual({ type: 'file', subtype: 'data' })
    expect(classifyFile('archive.zip', 'application/zip')).toEqual({ type: 'file', subtype: 'archive' })
    expect(classifyFile('clip.mov', 'video/quicktime')).toEqual({ type: 'video', subtype: null })
    expect(classifyFile('Makefile', null)).toEqual({ type: 'unknown', subtype: null })
  })

  it('canonicalizes urls and guesses subtypes', () => {
    expect(canonicalizeUrl('https://www.Example.com/Path/?utm_source=x&b=2&a=1#frag')).toEqual({
      url: 'https://www.example.com/Path/?utm_source=x&b=2&a=1#frag',
      canonical: 'https://example.com/Path?a=1&b=2',
      domain: 'example.com'
    })
    expect(canonicalizeUrl('https://youtu.be/abc123')?.canonical).toBe('https://youtube.com/watch?v=abc123')
    expect(canonicalizeUrl('https://x.com/someone/status/1')?.domain).toBe('twitter.com')
    expect(canonicalizeUrl('ftp://nope')).toBeNull()
    expect(canonicalizeUrl('not a url')).toBeNull()
    expect(guessUrlSubtype('github.com', '/vllm-project/vllm')).toBe('github_repo')
    expect(guessUrlSubtype('github.com', '/vllm-project/vllm/issues/1')).toBe('generic')
    expect(guessUrlSubtype('youtube.com', '/watch')).toBe('youtube')
    expect(guessUrlSubtype('docs.python.org', '/3')).toBe('docs')
    expect(isMediaUrl('https://a.b/c/image.PNG?x=1')).toBe(true)
    expect(isMediaUrl('https://a.b/page')).toBe(false)
    expect(parseUriList('# comment\nhttps://a.b\n\nhttps://c.d\r\n')).toEqual(['https://a.b', 'https://c.d'])
    expect(isTempPath('/private/var/folders/xy/T/TemporaryItems/a.png', '/tmp')).toBe(true)
    expect(isTempPath('/Users/me/Desktop/a.png', '/tmp')).toBe(false)
  })
})

describe('intake fallback', () => {
  let h: Harness
  let intake: Intake
  let sourceDir: string

  beforeEach(() => {
    h = createHarness({ withFiles: true })
    sourceDir = mkdtempSync(join(tmpdir(), 'ka-src-'))
    mkdirSync(join(sourceDir, 'tmp'))
    intake = createIntake({
      db: h.db,
      items: h.items,
      collections: h.collections,
      pipeline: h.queue,
      objectStore: h.objectStore,
      settings: () => settings,
      clock: h.clock,
      logger: silentLogger,
      tmpDir: join(sourceDir, 'tmp')
    })
  })
  afterEach(() => {
    h.close()
    rmSync(sourceDir, { recursive: true, force: true })
  })

  it('captures files with hash, managed copy, initial jobs and dedupes repeats', async () => {
    const file = join(sourceDir, 'notes.md')
    writeFileSync(file, '# Hello\n\nSome notes about inference.')
    const result = await intake.captureFiles([file], undefined, { source: 'dialog' })
    expect(result.items).toHaveLength(1)
    const [entry] = result.items
    expect(entry?.status).toBe('created')
    const item = h.repos.items.get(entry?.id ?? '')
    expect(item).toMatchObject({
      type: 'markdown',
      title: 'notes',
      mimeType: 'text/markdown',
      originalPath: file,
      captureBatchId: result.batchId
    })
    expect(item?.contentHash).toHaveLength(64)
    expect(item?.managedPath).toMatch(/notes\.md$/)
    expect(h.objectStore.managedExists(item?.managedPath ?? '')).toBe(true)
    expect(item?.excerpt).toContain('Hello')
    expect(
      h.repos.jobs
        .activeForItem(item?.id ?? '')
        .map((j) => j.stage)
        .sort()
    ).toEqual(['extract', 'thumbnail'])

    const again = await intake.captureFiles([file])
    expect(again.items[0]).toMatchObject({ status: 'duplicate', existingId: item?.id })
    expect(h.repos.items.count()).toBe(1)
    expect(h.repos.audit.forEntity('item', item?.id ?? '')[0]?.action).toBe('kept_again')
  })

  it('references instead of copying when asked, except for temp paths', async () => {
    const file = join(sourceDir, 'a.txt')
    writeFileSync(file, 'a')
    const referenced = await intake.captureFiles([file], 'reference')
    expect(h.repos.items.get(referenced.items[0]?.id ?? '')?.managedPath).toBeNull()
    const tmpFile = join(sourceDir, 'tmp', 'b.txt')
    writeFileSync(tmpFile, 'b')
    const copied = await intake.captureFiles([tmpFile], 'reference')
    expect(h.repos.items.get(copied.items[0]?.id ?? '')?.managedPath).not.toBeNull()
  })

  it('captures folders as one item and adds captured items to a collection', async () => {
    const collection = h.collections.create({ name: 'Set', createdBy: 'user' })
    const result = await intake.captureFiles([sourceDir], undefined, { source: 'dialog', collectionId: collection.id })
    const item = h.repos.items.get(result.items[0]?.id ?? '')
    expect(item?.type).toBe('folder')
    expect(h.repos.collections.getMember(collection.id, item?.id ?? '')).not.toBeNull()
    expect(h.repos.jobs.activeForItem(item?.id ?? '').map((j) => j.stage)).toEqual(['extract'])
  })

  it('captures urls with a provisional title and dedupes by canonical url', async () => {
    const first = await intake.captureUrl('https://github.com/vllm-project/vllm?utm_source=tw')
    const item = h.repos.items.get(first.items[0]?.id ?? '')
    expect(item).toMatchObject({
      type: 'url',
      subtype: 'github_repo',
      domain: 'github.com',
      canonicalUrl: 'https://github.com/vllm-project/vllm',
      title: 'vllm-project/vllm'
    })
    expect(
      h.repos.jobs
        .activeForItem(item?.id ?? '')
        .map((j) => j.stage)
        .sort()
    ).toEqual(['extract', 'snapshot'])
    const dup = await intake.captureUrl('https://www.github.com/vllm-project/vllm/')
    expect(dup.items[0]?.status).toBe('duplicate')
    await expect(intake.captureUrl('mailto:x@y.z')).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('captures text and blobs', async () => {
    const text = await intake.captureText('# Title line\n\n- a bullet')
    const item = h.repos.items.get(text.items[0]?.id ?? '')
    expect(item).toMatchObject({ type: 'markdown', title: 'Title line', excerpt: 'Title line a bullet' })
    expect(h.objectStore.managedExists(item?.managedPath ?? '')).toBe(true)
    const dup = await intake.captureText('# Title line\n\n- a bullet')
    expect(dup.items[0]?.status).toBe('duplicate')
    await expect(intake.captureText('   ')).rejects.toMatchObject({ code: 'VALIDATION' })

    const blob = await intake.captureBlob({ name: '', mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3]) })
    const image = h.repos.items.get(blob.items[0]?.id ?? '')
    expect(image?.type).toBe('image')
    expect(image?.metadata.originalName).toMatch(/^pasted-\d+\.png$/)
  })

  describe('captureDrop precedence', () => {
    it('a browser link drag (webloc + uri-list) keeps only the url', async () => {
      const webloc = join(sourceDir, 'Example.webloc')
      writeFileSync(webloc, '<plist/>')
      const result = await intake.captureDrop({
        files: [webloc],
        uriList: 'https://example.com/article',
        text: 'https://example.com/article',
        html: '<a href="https://example.com/article">Example Article</a>',
        source: 'library'
      })
      expect(result.items).toHaveLength(1)
      expect(h.repos.items.get(result.items[0]?.id ?? '')).toMatchObject({ type: 'url', title: 'Example Article' })
    })

    it('an image drag (temp file + image url) keeps the file and remembers the source url', async () => {
      const tmpFile = join(sourceDir, 'tmp', 'pic.png')
      writeFileSync(tmpFile, 'png-bytes')
      const result = await intake.captureDrop({
        files: [tmpFile],
        uriList: 'https://cdn.example.com/pic.png',
        source: 'shelf'
      })
      expect(result.items).toHaveLength(1)
      const item = h.repos.items.get(result.items[0]?.id ?? '')
      expect(item?.type).toBe('image')
      expect(item?.metadata.sourceUrl).toBe('https://cdn.example.com/pic.png')
      expect(item?.managedPath).not.toBeNull()
    })

    it('plain text that is exactly one url becomes a link; other text becomes a text item', async () => {
      const link = await intake.captureDrop({ files: [], text: 'https://example.com/only', source: 'library' })
      expect(h.repos.items.get(link.items[0]?.id ?? '')?.type).toBe('url')
      const note = await intake.captureDrop({ files: [], text: 'remember to compare providers', source: 'library' })
      expect(h.repos.items.get(note.items[0]?.id ?? '')?.type).toBe('text')
      await expect(intake.captureDrop({ files: [], source: 'library' })).rejects.toMatchObject({ code: 'VALIDATION' })
    })

    it('dedupes urls inside one drop and shares a batch id', async () => {
      const result = await intake.captureDrop({
        files: [],
        uriList: 'https://a.b/x\nhttps://www.a.b/x/\nhttps://c.d/y',
        source: 'library'
      })
      expect(result.items).toHaveLength(2)
      const items = result.items.map((r) => h.repos.items.get(r.id))
      expect(new Set(items.map((i) => i?.captureBatchId))).toEqual(new Set([result.batchId]))
    })
  })
})

describe('intake slice 3 behaviours', () => {
  let h: Harness
  let intake: Intake
  let sourceDir: string

  beforeEach(() => {
    h = createHarness({ withFiles: true })
    sourceDir = mkdtempSync(join(tmpdir(), 'ka-src3-'))
    mkdirSync(join(sourceDir, 'tmp'))
    intake = createIntake({
      db: h.db,
      items: h.items,
      collections: h.collections,
      pipeline: h.queue,
      objectStore: h.objectStore,
      settings: () => ({ ...settings, importMode: 'reference' }),
      clock: h.clock,
      logger: silentLogger,
      tmpDir: join(sourceDir, 'tmp')
    })
  })
  afterEach(() => {
    h.close()
    rmSync(sourceDir, { recursive: true, force: true })
  })

  it('folders get a shallow manifest with counts, sizes and top-level entries', async () => {
    const folder = join(sourceDir, 'project')
    mkdirSync(join(folder, 'src'), { recursive: true })
    mkdirSync(join(folder, 'node_modules', 'dep'), { recursive: true })
    writeFileSync(join(folder, 'README.md'), '# Project\n\nHello')
    writeFileSync(join(folder, 'src', 'main.ts'), 'export {}')
    writeFileSync(join(folder, 'node_modules', 'dep', 'index.js'), 'skip me')
    const result = await intake.captureFiles([folder])
    const item = h.repos.items.get(result.items[0]?.id ?? '')
    expect(item?.type).toBe('folder')
    expect(item?.metadata.folder).toMatchObject({
      fileCount: 2,
      dirCount: 1,
      truncated: false,
      extensions: { md: 1, ts: 1 }
    })
    const topLevel = item?.metadata.topLevel as { name: string }[]
    expect(topLevel.map((e) => e.name)).toEqual(['README.md', 'src'])
    expect(item?.size).toBeGreaterThan(0)
    expect(item?.excerpt).toContain('2 files')
  })

  it('screenshots are always copied even in reference mode; other images are referenced', async () => {
    const shot = join(sourceDir, 'Screenshot 2026-08-14 at 10.02.11.png')
    writeFileSync(
      shot,
      Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 5, 0xa0, 0, 0, 3,
        0x84, 8, 6, 0, 0, 0
      ])
    )
    const photo = join(sourceDir, 'IMG_0001.png')
    writeFileSync(
      photo,
      Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 10, 0, 0, 0, 10,
        8, 6, 0, 0, 0
      ])
    )
    const result = await intake.captureFiles([shot, photo])
    const [a, b] = result.items.map((r) => h.repos.items.get(r.id))
    expect(a).toMatchObject({ type: 'image', subtype: 'screenshot' })
    expect(a?.managedPath).not.toBeNull()
    expect(b).toMatchObject({ type: 'image', subtype: null, managedPath: null })
  })

  it('sniffs extensionless PDFs and images by magic bytes', async () => {
    const pdf = join(sourceDir, 'paper')
    writeFileSync(pdf, '%PDF-1.4\n%fake')
    const result = await intake.captureFiles([pdf])
    expect(h.repos.items.get(result.items[0]?.id ?? '')).toMatchObject({ type: 'pdf', mimeType: 'application/pdf' })
  })

  it('text captures derive a title from the first line or first sentence', async () => {
    const short = await intake.captureText('Compare inference providers\nsecond line')
    expect(h.repos.items.get(short.items[0]?.id ?? '')?.title).toBe('Compare inference providers')
    const long = await intake.captureText(
      `We should compare the inference providers on price and latency before Friday. ${'Then more text follows here. '.repeat(10)}`
    )
    expect(h.repos.items.get(long.items[0]?.id ?? '')?.title).toBe(
      'We should compare the inference providers on price and latency before Friday.'
    )
    const link = await intake.captureText('https://example.com/from-paste')
    expect(h.repos.items.get(link.items[0]?.id ?? '')?.type).toBe('url')
  })

  it('pasted images become PNG-named image items; pasted text blobs get their text', async () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 2, 8, 6,
      0, 0, 0
    ])
    const blob = await intake.captureBlob({ name: '', mimeType: 'image/png', bytes: png }, { source: 'paste' })
    const image = h.repos.items.get(blob.items[0]?.id ?? '')
    expect(image).toMatchObject({ type: 'image', mimeType: 'image/png' })
    expect(image?.metadata.originalName).toMatch(/^pasted-\d+\.png$/)
    expect(image?.title).toMatch(/^Pasted image 2026-09-03$/)
    expect(image?.metadata.pasted).toBe(true)
    const text = await intake.captureBlob({
      name: 'clip.txt',
      mimeType: 'text/plain',
      bytes: new TextEncoder().encode('hello clip')
    })
    expect(h.repos.items.get(text.items[0]?.id ?? '')).toMatchObject({
      type: 'text',
      extractedText: 'hello clip',
      title: 'clip'
    })
  })

  it('url captures record the detected kind and repo facts, and use owner/repo as the title', async () => {
    const repo = await intake.captureUrl('https://github.com/vllm-project/vllm/tree/main')
    const item = h.repos.items.get(repo.items[0]?.id ?? '')
    expect(item).toMatchObject({ subtype: 'github_repo', title: 'vllm-project/vllm' })
    expect(item?.metadata).toMatchObject({ urlKind: 'github_repo', repo: { owner: 'vllm-project', name: 'vllm' } })
    const paper = await intake.captureUrl('https://arxiv.org/pdf/2309.06180v2')
    expect(h.repos.items.get(paper.items[0]?.id ?? '')).toMatchObject({ subtype: 'paper' })
    const dup = await intake.captureUrl('https://arxiv.org/pdf/2309.06180v2?utm_source=x')
    expect(dup.items[0]?.status).toBe('duplicate')
  })

  it('drops from temp paths are copied and keep the source url; SPA fragments dedupe separately', async () => {
    const tmpFile = join(sourceDir, 'tmp', 'dragged.png')
    writeFileSync(tmpFile, 'x')
    const drop = await intake.captureDrop({
      files: [tmpFile],
      uriList: 'https://cdn.example.com/a.png',
      source: 'library'
    })
    const item = h.repos.items.get(drop.items[0]?.id ?? '')
    expect(item?.managedPath).not.toBeNull()
    expect(item?.metadata.sourceUrl).toBe('https://cdn.example.com/a.png')
    const spa = await intake.captureDrop({
      files: [],
      uriList: 'https://app.example.com/#/a\nhttps://app.example.com/#/b',
      source: 'library'
    })
    expect(spa.items).toHaveLength(2)
  })
})
