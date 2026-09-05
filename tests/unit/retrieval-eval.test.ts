/**
 * Retrieval evaluation: the 18 eval queries against a temp library seeded from
 * `tests/fixtures/corpus/manifest.json` (text-only content). Skipped unless `KEEPANYTHING_EVAL=1`;
 * `pnpm run eval:retrieval` sets it and prints recall@k and MRR. Not an assertion suite: it reports.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createEmbeddingProvider, createEmbeddingWorkerTasks, createHashEmbeddingProvider } from '../../src/main/ai'
import { silentLogger } from '../../src/main/lib/logger'
import type { EmbeddingProvider, WorkerClient } from '../../src/main/ports'
import { createRetrieval } from '../../src/main/retrieval'
import type { ItemSubtype, ItemType, Kind } from '../../src/shared/types'
import { createHarness } from './helpers/harness'

interface Fixture {
  id: string
  type: ItemType
  subtype?: ItemSubtype
  path?: string
  url?: string
  kind: Kind
  title: string
  topics: string[]
  entities: string[]
  captureOffsetDays: number
  children?: string[]
}

interface EvalQuery {
  id: string
  query: string
  style: string
  k?: number
  expected: string[]
  acceptable?: string[]
  mustNotOutrank?: string[]
}

interface Manifest {
  fixtures: Fixture[]
}
interface Queries {
  defaultK: number
  queries: EvalQuery[]
}

const FIXTURES = resolve(__dirname, '../fixtures/corpus')
const enabled = process.env.KEEPANYTHING_EVAL === '1'

function readText(path: string): string | null {
  const abs = join(FIXTURES, path)
  if (!existsSync(abs) || statSync(abs).isDirectory()) return null
  if (/\.(md|txt|csv|py|yaml|jsonl|json)$/i.test(path)) return readFileSync(abs, 'utf8').slice(0, 60_000)
  return null
}

describe.skipIf(!enabled)('retrieval eval', () => {
  it('prints recall@k and MRR over the demo eval queries', async () => {
    const manifest = JSON.parse(readFileSync(join(FIXTURES, 'manifest.json'), 'utf8')) as Manifest
    const queries = JSON.parse(readFileSync(join(FIXTURES, 'eval-queries.json'), 'utf8')) as Queries
    const h = createHarness()
    const modelsDir = resolve(__dirname, '../../build/models')
    let embeddings: EmbeddingProvider = createHashEmbeddingProvider()
    let backend = 'local-hash'
    if (process.env.KEEPANYTHING_EVAL_MODEL !== 'hash') {
      // The worker registry runs in-process here (no utilityProcess outside Electron).
      const tasks = createEmbeddingWorkerTasks()
      const worker: WorkerClient = {
        call: async <T>(task: string, payload: unknown): Promise<T> => {
          const handler = tasks[task]
          if (!handler) throw new Error(`unknown worker task ${task}`)
          return (await handler(payload, new AbortController().signal)) as T
        },
        terminate: () => {}
      }
      const local = createEmbeddingProvider({ worker, modelsDir, logger: silentLogger })
      await local.ready()
      backend = local.backend()
      embeddings = local
    }
    const retrieval = createRetrieval({ db: h.db, repos: h.repos, embeddings, logger: silentLogger, clock: h.clock })
    await retrieval.warm()

    const now = h.clock.now().getTime()
    const idOf = new Map<string, string>()
    for (const f of manifest.fixtures) {
      const capturedAt = new Date(now - f.captureOffsetDays * 86_400_000).toISOString()
      const text = f.path ? readText(f.path) : null
      const domain = f.url ? new URL(f.url).hostname.replace(/^www\./, '') : null
      const hints = [...f.topics.map((t) => t.replace(/-/g, ' ')), ...f.entities]
      const item = h.item({
        type: f.type,
        subtype: f.subtype ?? null,
        kind: f.kind,
        title: f.title,
        url: f.url ?? null,
        domain,
        topics: f.topics.map((t) => t.replace(/-/g, ' ')),
        entities: f.entities,
        retrievalHints: hints,
        extractedText: text,
        excerpt: text ? text.replace(/\s+/g, ' ').slice(0, 280) : null,
        capturedAt,
        createdAt: capturedAt,
        processingStatus: 'READY',
        metadata: domain ? { siteName: domain } : {}
      })
      idOf.set(f.id, item.id)
      if (f.type === 'folder' && f.path) {
        const dir = join(FIXTURES, f.path)
        for (const name of existsSync(dir) ? readdirSync(dir) : []) {
          const child = h.item({
            type: /\.(md|txt)$/.test(name) ? (name.endsWith('.md') ? 'markdown' : 'text') : 'file',
            title: name,
            parentItemId: item.id,
            extractedText: readText(`${f.path}/${name}`),
            capturedAt,
            processingStatus: 'READY'
          })
          await retrieval.embedBody(child.id)
          await retrieval.indexItem(child.id)
        }
      }
      await retrieval.embedBody(item.id)
      await retrieval.indexItem(item.id)
    }
    const fixtureOf = new Map([...idOf].map(([fid, id]) => [id, fid]))

    const rows: string[] = []
    let hits = 0
    let mrr = 0
    let ordering = 0
    let orderingOk = 0
    for (const q of queries.queries) {
      const k = q.k ?? queries.defaultK
      const started = performance.now()
      const results = await retrieval.quickSearch(q.query, { limit: 10 })
      const ms = performance.now() - started
      const ranked = results.map((r) => fixtureOf.get(r.id) ?? '?')
      const good = new Set([...q.expected, ...(q.acceptable ?? [])])
      const firstRank = ranked.findIndex((id) => q.expected.includes(id))
      const inTop = ranked.slice(0, k).some((id) => q.expected.includes(id))
      if (inTop) hits++
      if (firstRank >= 0) mrr += 1 / (firstRank + 1)
      if (q.mustNotOutrank) {
        ordering++
        const bad = Math.min(...q.mustNotOutrank.map((id) => (ranked.indexOf(id) === -1 ? 99 : ranked.indexOf(id))))
        if (firstRank >= 0 && firstRank < bad) orderingOk++
      }
      const acceptableTop = ranked.slice(0, k).filter((id) => good.has(id)).length
      rows.push(
        `${inTop ? 'hit ' : 'miss'} ${q.id.padEnd(28)} rank=${firstRank >= 0 ? firstRank + 1 : '-'} top${k}=${ranked
          .slice(0, k)
          .join(',')} acceptable=${acceptableTop} ${ms.toFixed(1)}ms`
      )
    }
    const n = queries.queries.length
    const report = [
      `retrieval eval: ${n} queries, embeddings=${backend}`,
      ...rows,
      `recall@k = ${(hits / n).toFixed(3)} (${hits}/${n}), MRR = ${(mrr / n).toFixed(3)}${ordering > 0 ? `, ordering constraints ${orderingOk}/${ordering}` : ''}`
    ].join('\n')
    process.stdout.write(`${report}\n`)
    h.close()
    expect(n).toBeGreaterThan(0)
  })
})
