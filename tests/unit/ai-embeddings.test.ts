import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  createEmbeddingProvider,
  createEmbeddingWorkerTasks,
  EMBEDDING_WORKER_TASKS,
  fnv1a,
  hashEmbed,
  MODEL_FILES,
  modelFilesPresent,
  tokenize
} from '../../src/main/ai/embeddings'
import { loadMiniLm } from '../../src/main/ai/embeddings/transformers'
import type { Logger, WorkerClient } from '../../src/main/ports'
import { EMBEDDING_DIMS, EMBEDDING_MODEL_ID } from '../../src/shared/constants'

const logs: { level: string; msg: string }[] = []
const logger: Logger = {
  debug: (msg) => logs.push({ level: 'debug', msg }),
  info: (msg) => logs.push({ level: 'info', msg }),
  warn: (msg) => logs.push({ level: 'warn', msg }),
  error: (msg) => logs.push({ level: 'error', msg }),
  child: () => logger
}

const norm = (v: Float32Array): number => Math.sqrt(v.reduce((s, x) => s + x * x, 0))
const dot = (a: Float32Array, b: Float32Array): number => a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0)

describe('hash embeddings', () => {
  it('are deterministic, 384-d and L2-normalized', () => {
    const a = hashEmbed('PagedAttention manages the KV cache in fixed-size blocks.')
    const b = hashEmbed('PagedAttention manages the KV cache in fixed-size blocks.')
    expect(a).toHaveLength(EMBEDDING_DIMS)
    expect(Array.from(a)).toEqual(Array.from(b))
    expect(norm(a)).toBeCloseTo(1, 5)
  })

  it('place related texts closer than unrelated ones', () => {
    const a = hashEmbed('vLLM continuous batching keeps the GPU busy while serving inference requests')
    const b = hashEmbed('inference serving with continuous batching on a GPU')
    const c = hashEmbed('a sourdough bread recipe with a long cold ferment')
    expect(dot(a, b)).toBeGreaterThan(dot(a, c))
  })

  it('returns a zero vector for empty text and tokenizes predictably', () => {
    expect(norm(hashEmbed(''))).toBe(0)
    expect(tokenize('The Quick, brown fox! is 42')).toEqual(['quick', 'brown', 'fox', '42'])
    expect(fnv1a('abc')).toBe(fnv1a('abc'))
    expect(fnv1a('abc')).not.toBe(fnv1a('abd'))
  })
})

describe('embedding worker tasks', () => {
  it('exposes init/texts/status and batches through the loader', async () => {
    const calls: string[][] = []
    const tasks = createEmbeddingWorkerTasks(async () => ({
      modelId: EMBEDDING_MODEL_ID,
      dims: 384,
      loadMs: 1,
      embed: async (texts) => {
        calls.push(texts)
        return texts.map((_, i) => Array.from({ length: 384 }, (_x, j) => (j === i ? 1 : 0)))
      }
    }))
    const signal = new AbortController().signal
    expect(await tasks['embed.status']?.({}, signal)).toMatchObject({ loaded: false, modelsDir: null })
    await expect(tasks['embed.texts']?.({ texts: ['x'] }, signal)).rejects.toThrow(/embed.init/)
    const init = await tasks['embed.init']?.({ modelsDir: '/tmp/models' }, signal)
    expect(init).toMatchObject({ loaded: true, dims: 384, modelsDir: '/tmp/models' })
    const vectors = (await tasks['embed.texts']?.({ texts: ['a', 'b'] }, signal)) as number[][]
    expect(vectors).toHaveLength(2)
    expect(vectors[1]?.[1]).toBe(1)
    expect(calls).toEqual([['a', 'b']])
    expect(await tasks['embed.texts']?.({ texts: [] }, signal)).toEqual([])
    await expect(tasks['embed.init']?.({}, signal)).rejects.toThrow()
    expect(Object.keys(EMBEDDING_WORKER_TASKS).sort()).toEqual(['embed.init', 'embed.status', 'embed.texts'])
  })
})

describe('createEmbeddingProvider', () => {
  it('falls back to local-hash without a worker or model files', async () => {
    logs.length = 0
    const provider = createEmbeddingProvider({ modelsDir: '/nonexistent/models', logger })
    expect(await provider.ready()).toBe(true)
    expect(provider.id).toBe('local-hash')
    expect(provider.backend()).toBe('local-hash')
    expect(provider.modelPresent()).toBe(false)
    const [v] = await provider.embed(['hello world'])
    expect(v).toBeInstanceOf(Float32Array)
    expect(norm(v as Float32Array)).toBeCloseTo(1, 5)
    expect(logs.some((l) => l.level === 'warn' && l.msg === 'embeddings.fallback')).toBe(true)
  })

  it('falls back when the model files are missing even with a worker', async () => {
    const worker: WorkerClient = { call: (async () => []) as WorkerClient['call'], terminate() {} }
    const provider = createEmbeddingProvider({ worker, modelsDir: '/nonexistent/models', logger })
    await provider.ready()
    expect(provider.id).toBe('local-hash')
  })

  it('uses the worker when files exist and embed.init succeeds, batching by 32', async () => {
    const calls: { task: string; payload: unknown }[] = []
    const worker: WorkerClient = {
      call: async <T>(task: string, payload: unknown) => {
        calls.push({ task, payload })
        if (task === 'embed.init') return { loaded: true, modelId: EMBEDDING_MODEL_ID, dims: 384, loadMs: 5 } as T
        const { texts } = payload as { texts: string[] }
        return texts.map(() => Array.from({ length: 384 }, () => 0.05)) as T
      },
      terminate() {}
    }
    // Model files presence is decided via the filesystem; point at the repo's build/models when fetched,
    // otherwise stub by pointing at a directory that has them. Skip when neither is available.
    const modelsDir = fileURLToPath(new URL('../../build/models', import.meta.url))
    if (!modelFilesPresent(modelsDir)) return
    const provider = createEmbeddingProvider({ worker, modelsDir, logger })
    await provider.ready()
    expect(provider.id).toBe('minilm')
    expect(provider.model).toBe(EMBEDDING_MODEL_ID)
    const vectors = await provider.embed(Array.from({ length: 70 }, (_, i) => `text ${i}`))
    expect(vectors).toHaveLength(70)
    expect(vectors[0]).toBeInstanceOf(Float32Array)
    const textCalls = calls.filter((c) => c.task === 'embed.texts')
    expect(textCalls.map((c) => (c.payload as { texts: string[] }).texts.length)).toEqual([32, 32, 6])
  })

  it('re-inits and retries once when a worker call fails', async () => {
    const modelsDir = fileURLToPath(new URL('../../build/models', import.meta.url))
    if (!modelFilesPresent(modelsDir)) return
    let textCalls = 0
    const tasks: string[] = []
    const worker: WorkerClient = {
      call: async <T>(task: string, payload: unknown) => {
        tasks.push(task)
        if (task === 'embed.init') return { loaded: true, modelId: EMBEDDING_MODEL_ID, dims: 384, loadMs: 5 } as T
        textCalls++
        if (textCalls === 1) throw new Error('worker crashed')
        return (payload as { texts: string[] }).texts.map(() => new Array<number>(384).fill(0)) as T
      },
      terminate() {}
    }
    const provider = createEmbeddingProvider({ worker, modelsDir, logger })
    const vectors = await provider.embed(['a'])
    expect(vectors).toHaveLength(1)
    expect(tasks).toEqual(['embed.init', 'embed.texts', 'embed.init', 'embed.texts'])
  })
})

describe('MiniLM (real model, only when build/models is fetched)', () => {
  const modelsDir = fileURLToPath(new URL('../../build/models', import.meta.url))
  const present = MODEL_FILES.every((f) => existsSync(`${modelsDir}/${EMBEDDING_MODEL_ID}/${f}`))

  it.skipIf(!present)(
    'loads offline and returns normalized 384-d vectors',
    async () => {
      const extractor = await loadMiniLm(modelsDir)
      const [a, b, c] = await extractor.embed([
        'PagedAttention manages the KV cache in fixed-size blocks so vLLM can serve many requests.',
        'Continuous batching keeps the GPU busy by admitting new requests as soon as a slot frees up.',
        'A recipe for sourdough bread with a long cold ferment and a very hot Dutch oven.'
      ])
      expect(a).toHaveLength(384)
      const fa = Float32Array.from(a ?? [])
      const fb = Float32Array.from(b ?? [])
      const fc = Float32Array.from(c ?? [])
      expect(norm(fa)).toBeCloseTo(1, 3)
      expect(dot(fa, fb)).toBeGreaterThan(dot(fa, fc))
    },
    60_000
  )
})
