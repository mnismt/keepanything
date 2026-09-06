import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { canonicalizeUrl, guessUrlSubtype, isSingleUrl } from '../../src/main/capture/url'
import { urlExtractor } from '../../src/main/extraction/url'
import { parseArxivAbs } from '../../src/main/extraction/url/adapters/arxiv'
import { repoMetadataFrom } from '../../src/main/extraction/url/adapters/github'
import { tweetTextFromHtml } from '../../src/main/extraction/url/adapters/twitter'
import { detectUrlKind, refineSubtype, subtypeForUrl } from '../../src/main/extraction/url/detect'
import { parsePageMetadata } from '../../src/main/extraction/url/metadata'
import { analyzeHtml } from '../../src/main/extraction/url/readable'
import { createManualClock } from '../../src/main/lib/clock'
import { silentLogger } from '../../src/main/lib/logger'
import { fakeItem, fetchStub, htmlResponse, jsonResponse } from './helpers/fake-item'

const ARTICLE = readFileSync(resolve(__dirname, '../fixtures/html/article.html'), 'utf8')
const ARXIV = readFileSync(resolve(__dirname, '../fixtures/html/arxiv-abs.html'), 'utf8')
const PDF = readFileSync(resolve(__dirname, '../fixtures/corpus/files/react-reasoning-acting-2210.03629.pdf'))
const baseDeps = { logger: silentLogger, clock: createManualClock() }

describe('url canonicalization table', () => {
  const table: [string, string][] = [
    ['https://www.Example.com/Path/?utm_source=x&b=2&a=1#frag', 'https://example.com/Path?a=1&b=2'],
    ['https://youtu.be/abc123?si=share', 'https://youtube.com/watch?v=abc123'],
    ['https://m.youtube.com/watch?v=abc123&list=PL1&t=42', 'https://youtube.com/watch?v=abc123'],
    ['https://www.youtube.com/shorts/xyz', 'https://youtube.com/watch?v=xyz'],
    ['https://x.com/someone/status/1?s=20&t=abc', 'https://twitter.com/someone/status/1'],
    ['https://mobile.twitter.com/a/status/2', 'https://twitter.com/a/status/2'],
    ['https://example.com/a//b/index.html', 'https://example.com/a/b'],
    ['http://example.com:80/page?fbclid=1&gclid=2&ref=hn', 'https://example.com/page'],
    ['https://app.example.com/#/settings/keys', 'https://app.example.com#/settings/keys'],
    ['https://old.reddit.com/r/x/comments/1/t/?context=3', 'https://reddit.com/r/x/comments/1/t'],
    ['https://en.m.wikipedia.org/wiki/RAG', 'https://en.wikipedia.org/wiki/RAG'],
    ['https://blog.example.com/post?id=7&utm_medium=email', 'https://blog.example.com/post?id=7']
  ]
  it.each(table)('%s → %s', (input, expected) => {
    expect(canonicalizeUrl(input)?.canonical).toBe(expected)
  })
  it('rejects non-http input and keeps the original url form', () => {
    expect(canonicalizeUrl('mailto:a@b.c')).toBeNull()
    expect(canonicalizeUrl('https://')).toBeNull()
    expect(canonicalizeUrl('https://Example.com/x?utm_source=1')?.url).toBe('https://example.com/x?utm_source=1')
    expect(isSingleUrl(' https://a.b/c ')).toBe(true)
    expect(isSingleUrl('see https://a.b/c')).toBe(false)
  })
})

describe('url kind detection table', () => {
  const kinds: [string, string][] = [
    ['https://github.com/vllm-project/vllm', 'github_repo'],
    ['https://github.com/vllm-project/vllm/tree/main', 'github_repo'],
    ['https://github.com/vllm-project/vllm/issues/123', 'github_issue'],
    ['https://github.com/vllm-project/vllm/pull/9', 'github_pr'],
    ['https://github.com/vllm-project/vllm/blob/main/README.md', 'github_other'],
    ['https://www.youtube.com/watch?v=zjkBMFhNj_g', 'youtube'],
    ['https://youtu.be/zjkBMFhNj_g', 'youtube'],
    ['https://x.com/karpathy/status/1', 'tweet'],
    ['https://arxiv.org/abs/2309.06180', 'arxiv'],
    ['https://arxiv.org/pdf/2309.06180v2.pdf', 'arxiv'],
    ['https://example.com/paper.pdf', 'pdf'],
    ['https://www.raycast.com/', 'generic']
  ]
  it.each(kinds)('%s → %s', (url, kind) => {
    expect(detectUrlKind(url).kind).toBe(kind)
  })
  it('extracts owner/repo/number/ids and maps to subtypes', () => {
    expect(detectUrlKind('https://github.com/a/b.git/issues/12')).toMatchObject({ owner: 'a', repo: 'b', number: 12 })
    expect(detectUrlKind('https://youtu.be/abc').videoId).toBe('abc')
    expect(detectUrlKind('https://arxiv.org/pdf/2309.06180v2')).toMatchObject({
      arxivId: '2309.06180v2',
      absUrl: 'https://arxiv.org/abs/2309.06180v2'
    })
    expect(subtypeForUrl(detectUrlKind('https://github.com/a/b'))).toBe('github_repo')
    expect(subtypeForUrl(detectUrlKind('https://github.com/a/b/issues/1'))).toBe('generic')
    expect(subtypeForUrl(detectUrlKind('https://arxiv.org/abs/1'))).toBe('generic')
    expect(subtypeForUrl(detectUrlKind('https://arxiv.org/abs/2309.06180'))).toBe('paper')
    expect(subtypeForUrl(detectUrlKind('https://www.figma.com/file/x'))).toBe('figma')
    expect(subtypeForUrl(detectUrlKind('https://www.linkedin.com/in/x'))).toBe('social')
    expect(subtypeForUrl(detectUrlKind('https://www.electronjs.org/docs/latest/api/utility-process'))).toBe('docs')
    expect(subtypeForUrl(detectUrlKind('https://sqlite.org/fts5.html'))).toBe('generic')
    expect(guessUrlSubtype('youtube.com', '/watch')).toBe('youtube')
    expect(guessUrlSubtype('docs.python.org', '/3')).toBe('docs')
    expect(refineSubtype('generic', { ogType: 'article', readableChars: 100 })).toBe('article')
    expect(refineSubtype('generic', { jsonLdTypes: ['Product'], readableChars: 5000 })).toBe('product')
    expect(refineSubtype('generic', { readableChars: 5000 })).toBe('article')
    expect(refineSubtype('generic', { readableChars: 100 })).toBe('generic')
    expect(refineSubtype('docs', { ogType: 'article', readableChars: 5000 })).toBe('docs')
  })
})

describe('page metadata + readability', () => {
  it('parses head metadata from the article fixture', async () => {
    const meta = await parsePageMetadata(ARTICLE, 'https://blog.example.com/posts/continuous-batching/')
    expect(meta).toMatchObject({
      title: 'Continuous batching for LLM inference',
      description: expect.stringContaining('continuous batching raises throughput'),
      canonical: 'https://blog.example.com/posts/continuous-batching/',
      siteName: 'Example Engineering',
      ogImage: 'https://blog.example.com/images/batching-hero.png',
      ogType: 'article',
      publishedAt: '2026-03-14T09:30:00.000Z',
      byline: 'Ada Example',
      lang: 'en',
      favicon: 'https://blog.example.com/apple-touch-icon.png',
      jsonLdTypes: ['BlogPosting']
    })
  })

  it('produces a readable article as markdown', async () => {
    const { metadata, readable } = await analyzeHtml(ARTICLE, 'https://blog.example.com/posts/continuous-batching/')
    expect(metadata.title).toBe('Continuous batching for LLM inference')
    expect(readable).not.toBeNull()
    expect(readable?.length).toBeGreaterThan(1500)
    expect(readable?.markdown).toContain('## What we measured')
    expect(readable?.markdown).toContain('- Use continuous batching whenever request lengths vary.')
    expect(readable?.markdown).toContain('```')
    expect(readable?.text).toContain('iteration-level scheduling')
    expect(readable?.markdown).not.toContain('dataLayer')
  })

  // linkedom's <canvas> element calls `createCanvas` from the optional `canvas` peer. Without the alias in
  // electron.vite.config.ts the bundle gets `{}` instead of linkedom's shim and this constructor throws.
  it('parses HTML containing a <canvas> element', async () => {
    const html = ARTICLE.replace('</article>', '<canvas width="600" height="200"></canvas></article>')
    const { readable } = await analyzeHtml(html, 'https://blog.example.com/posts/continuous-batching/')
    expect(readable?.text).toContain('iteration-level scheduling')
  })
})

describe('url adapters (stubbed network)', () => {
  let cacheDir: string
  let objectsDir: string
  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), 'ka-urlcache-'))
    objectsDir = mkdtempSync(join(tmpdir(), 'ka-objects-'))
  })
  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true })
    rmSync(objectsDir, { recursive: true, force: true })
  })

  const urlItem = (url: string, extra: Partial<ReturnType<typeof fakeItem>> = {}) =>
    fakeItem({
      type: 'url',
      url,
      canonicalUrl: canonicalizeUrl(url)?.canonical ?? url,
      domain: canonicalizeUrl(url)?.domain ?? null,
      title: 'provisional',
      ...extra
    })

  it('generic: fetch → metadata + markdown, caches the html, and replays offline', async () => {
    const url = 'https://blog.example.com/posts/continuous-batching/'
    const stub = fetchStub({ [url]: () => htmlResponse(ARTICLE) })
    const deps = { ...baseDeps, fetchImpl: stub.fetchImpl, urlCacheDir: cacheDir }
    const out = await urlExtractor.extract({ item: urlItem(url), filePath: null }, deps)
    expect(out.title).toBe('Continuous batching for LLM inference')
    expect(out.item?.subtype).toBe('article')
    expect(out.markdown).toContain('## What we measured')
    expect(out.text).toContain('Static batching groups requests')
    expect(out.meta).toMatchObject({
      siteName: 'Example Engineering',
      byline: 'Ada Example',
      publishedAt: '2026-03-14T09:30:00.000Z',
      fetchedVia: 'fetch',
      urlKind: 'generic'
    })
    expect((out.meta.og as { image: string }).image).toBe('https://blog.example.com/images/batching-hero.png')
    expect(out.partial).toBeUndefined()
    expect(readdirSync(cacheDir)).toHaveLength(1)

    const offline = fetchStub({})
    const again = await urlExtractor.extract(
      { item: urlItem(url), filePath: null },
      { ...baseDeps, fetchImpl: offline.fetchImpl, urlCacheDir: cacheDir }
    )
    expect(offline.calls).toHaveLength(0)
    expect(again.meta.fetchedVia).toBe('cache')
    expect(again.title).toBe(out.title)
  })

  it('generic: network failure throws (retry), 404 with no DOM fallback is partial and keeps the link', async () => {
    const url = 'https://down.example.com/x'
    const failing = {
      fetchImpl: async (): Promise<Response> => {
        throw new TypeError('fetch failed')
      }
    }
    await expect(
      urlExtractor.extract({ item: urlItem(url), filePath: null }, { ...baseDeps, fetchImpl: failing.fetchImpl })
    ).rejects.toThrow(/Could not reach/)
    const gone = fetchStub({})
    const out = await urlExtractor.extract(
      { item: urlItem(url), filePath: null },
      { ...baseDeps, fetchImpl: gone.fetchImpl }
    )
    expect(out.partial).toBe(true)
    expect(out.meta.httpStatus).toBe(404)
    expect(out.text).toBe('')
  })

  it('generic: falls back to the DOM fetcher when the plain fetch is thin', async () => {
    const url = 'https://spa.example.com/app'
    const stub = fetchStub({
      [url]: () => htmlResponse('<html><head><title>App</title></head><body><div id="root"></div></body></html>')
    })
    let domCalls = 0
    const pageFetcher = {
      fetchHtml: async () => null,
      fetchDom: async () => {
        domCalls += 1
        return { html: ARTICLE, title: 'Rendered', finalUrl: url }
      }
    }
    const out = await urlExtractor.extract(
      { item: urlItem(url), filePath: null },
      { ...baseDeps, fetchImpl: stub.fetchImpl, pageFetcher, urlCacheDir: cacheDir }
    )
    expect(domCalls).toBe(1)
    expect(out.meta.fetchedVia).toBe('dom')
    expect(out.markdown).toContain('What we measured')
    const cached = JSON.parse(readFileSync(join(cacheDir, readdirSync(cacheDir)[0] ?? ''), 'utf8')) as { via: string }
    expect(cached.via).toBe('dom')
  })

  it('pdf by header: keeps the bytes in objects/, extracts text and asks for a thumbnail', async () => {
    const url = 'https://example.com/downloads/react.pdf'
    const stub = fetchStub({
      [url]: () => new Response(new Uint8Array(PDF), { status: 200, headers: { 'content-type': 'application/pdf' } })
    })
    const stored: string[] = []
    const objectStore = {
      writeBytes: async (itemId: string, name: string, bytes: Uint8Array) => {
        const { mkdirSync, writeFileSync } = await import('node:fs')
        mkdirSync(join(objectsDir, itemId), { recursive: true })
        writeFileSync(join(objectsDir, itemId, name), bytes)
        stored.push(`${itemId}/${name}`)
        return { managedPath: `${itemId}/${name}`, size: bytes.byteLength, sha256: 'deadbeef' }
      },
      resolve: (managedPath: string) => join(objectsDir, managedPath)
    }
    const out = await urlExtractor.extract(
      { item: urlItem(url), filePath: null },
      { ...baseDeps, fetchImpl: stub.fetchImpl, objectStore }
    )
    expect(stored).toEqual(['item-1/react.pdf'])
    expect(out.item).toMatchObject({ managedPath: 'item-1/react.pdf', mimeType: 'application/pdf', subtype: 'paper' })
    expect(out.pageCount).toBe(33)
    expect(out.followUp).toEqual(['thumbnail'])
    expect(out.meta.urlKind).toBe('pdf')
    expect(out.text).toMatch(/ICLR 2023/)
  })

  it('github repo: REST facts + README, falling back to the page on rate limit', async () => {
    const url = 'https://github.com/vllm-project/vllm'
    const stub = fetchStub({
      'https://api.github.com/repos/vllm-project/vllm': () =>
        jsonResponse({
          full_name: 'vllm-project/vllm',
          description: 'A high-throughput and memory-efficient inference and serving engine for LLMs',
          language: 'Python',
          stargazers_count: 50000,
          forks_count: 8000,
          topics: ['llm', 'inference', 'cuda'],
          default_branch: 'main',
          homepage: 'https://docs.vllm.ai',
          license: { spdx_id: 'Apache-2.0' },
          pushed_at: '2026-09-01T00:00:00Z',
          owner: { login: 'vllm-project', avatar_url: 'https://avatars.githubusercontent.com/u/1' }
        }),
      'https://api.github.com/repos/vllm-project/vllm/readme': () =>
        new Response(
          `# vLLM\n\nEasy, fast, and cheap LLM serving for everyone.\n\n${'More readme text. '.repeat(400)}`,
          {
            status: 200,
            headers: { 'content-type': 'text/plain' }
          }
        )
    })
    const out = await urlExtractor.extract(
      { item: urlItem(url), filePath: null },
      { ...baseDeps, fetchImpl: stub.fetchImpl }
    )
    expect(out.title).toBe('vllm-project/vllm')
    expect(out.item?.subtype).toBe('github_repo')
    expect(out.meta.repo).toMatchObject({
      owner: 'vllm-project',
      name: 'vllm',
      language: 'Python',
      stars: 50000,
      license: 'Apache-2.0'
    })
    expect(out.markdown?.length).toBe(4000)
    expect(out.truncated).toBe(true)
    expect(out.text).toContain('Topics: llm, inference, cuda')
    expect(out.text).toContain('Easy, fast, and cheap LLM serving')
    expect(out.meta.excerpt).toContain('high-throughput')

    const limited = fetchStub({
      'https://api.github.com/repos/vllm-project/vllm': () => jsonResponse({ message: 'rate limited' }, 403),
      [url]: () => htmlResponse(ARTICLE)
    })
    const fallback = await urlExtractor.extract(
      { item: urlItem(url), filePath: null },
      { ...baseDeps, fetchImpl: limited.fetchImpl, urlCacheDir: cacheDir }
    )
    expect(fallback.meta.githubApiStatus).toBe(403)
    expect(fallback.item?.subtype).toBe('github_repo')
    expect(fallback.title).toBe('Continuous batching for LLM inference')
  })

  it('github issue / pr: title, state, labels, body', async () => {
    const url = 'https://github.com/vllm-project/vllm/pull/42'
    const stub = fetchStub({
      'https://api.github.com/repos/vllm-project/vllm/issues/42': () =>
        jsonResponse({
          number: 42,
          title: 'Add paged KV cache',
          body: 'This PR adds **paged** KV cache.\n\nCloses #1.',
          state: 'closed',
          labels: [{ name: 'perf' }],
          user: { login: 'octocat' },
          comments: 3,
          created_at: '2026-08-01T00:00:00Z',
          pull_request: { merged_at: '2026-08-02T00:00:00Z' }
        })
    })
    const out = await urlExtractor.extract(
      { item: urlItem(url), filePath: null },
      { ...baseDeps, fetchImpl: stub.fetchImpl }
    )
    expect(out.title).toBe('Add paged KV cache · vllm-project/vllm#42')
    expect(out.meta.issue).toMatchObject({ kind: 'pr', state: 'merged', labels: ['perf'], author: 'octocat' })
    expect(out.text).toContain('Pull request #42')
    expect(out.text).toContain('This PR adds paged KV cache.')
    expect(out.meta.urlKind).toBe('github_pr')
    expect(repoMetadataFrom({}, 'a', 'b')).toEqual({ owner: 'a', name: 'b' })
  })

  it('arxiv: abs metadata (title, authors, abstract, date)', async () => {
    const facts = await parseArxivAbs(ARXIV, '2309.06180')
    expect(facts.title).toBe('Efficient Memory Management for Large Language Model Serving with PagedAttention')
    expect(facts.authors).toEqual(['Kwon, Woosuk', 'Li, Zhuohan', 'Zhuang, Siyuan'])
    expect(facts.abstract).toContain('PagedAttention')
    expect(facts.published).toBe('2023-09-12T00:00:00.000Z')
    expect(facts.subjects).toContain('cs.LG')
    const url = 'https://arxiv.org/abs/2309.06180'
    const stub = fetchStub({ [url]: () => htmlResponse(ARXIV) })
    const out = await urlExtractor.extract(
      { item: urlItem(url), filePath: null },
      { ...baseDeps, fetchImpl: stub.fetchImpl }
    )
    expect(out.item?.subtype).toBe('paper')
    expect(out.title).toBe(facts.title)
    expect(out.meta.byline).toContain('Kwon, Woosuk')
    expect(out.markdown).toContain('## Abstract')
    expect(out.meta.publishedAt).toBe('2023-09-12T00:00:00.000Z')
  })

  it('youtube: oEmbed title/author/thumbnail (+ description from the watch page)', async () => {
    const url = 'https://www.youtube.com/watch?v=zjkBMFhNj_g'
    const stub = fetchStub({
      'https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DzjkBMFhNj_g&format=json': () =>
        jsonResponse({
          title: 'Attention in transformers, visually explained',
          author_name: '3Blue1Brown',
          author_url: 'https://www.youtube.com/@3blue1brown',
          thumbnail_url: 'https://i.ytimg.com/vi/zjkBMFhNj_g/hqdefault.jpg'
        }),
      'https://www.youtube.com/watch?v=zjkBMFhNj_g': () =>
        htmlResponse(
          '<html><head><meta name="description" content="Chapter 6 of the deep learning series."></head><body></body></html>'
        )
    })
    const out = await urlExtractor.extract(
      { item: urlItem(url), filePath: null },
      { ...baseDeps, fetchImpl: stub.fetchImpl }
    )
    expect(out.title).toBe('Attention in transformers, visually explained')
    expect(out.item?.subtype).toBe('youtube')
    expect(out.meta.byline).toBe('3Blue1Brown')
    expect(out.meta.description).toBe('Chapter 6 of the deep learning series.')
    expect((out.meta.og as { image: string }).image).toBe('https://i.ytimg.com/vi/zjkBMFhNj_g/hqdefault.jpg')
    expect(out.meta.video).toMatchObject({ provider: 'youtube', id: 'zjkBMFhNj_g' })
  })

  it('tweet: oEmbed text + author', async () => {
    const url = 'https://x.com/karpathy/status/1'
    const stub = fetchStub({
      'https://publish.twitter.com/oembed?url=https%3A%2F%2Fx.com%2Fkarpathy%2Fstatus%2F1&omit_script=true&dnt=true':
        () =>
          jsonResponse({
            html: '<blockquote class="twitter-tweet"><p lang="en">The hottest new programming language is English &amp; it is fun.</p>&mdash; Andrej Karpathy (@karpathy) <a href="https://twitter.com/karpathy/status/1">January 24, 2023</a></blockquote>',
            author_name: 'Andrej Karpathy',
            author_url: 'https://twitter.com/karpathy'
          })
    })
    expect(
      tweetTextFromHtml('<blockquote><p>Hi<br>there</p>&mdash; A (@a) <a href="x">May 1, 2020</a></blockquote>')
    ).toBe('Hi\nthere')
    const out = await urlExtractor.extract(
      { item: urlItem(url), filePath: null },
      { ...baseDeps, fetchImpl: stub.fetchImpl }
    )
    expect(out.item?.subtype).toBe('tweet')
    expect(out.text).toContain('The hottest new programming language is English & it is fun.')
    expect(out.meta.tweet).toMatchObject({ author: 'Andrej Karpathy', handle: 'karpathy' })
    expect(out.title?.startsWith('Andrej Karpathy: The hottest')).toBe(true)
  })
})
