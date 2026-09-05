#!/usr/bin/env node

// embed-probe.mjs — verify the local MiniLM embedding model loads and runs offline in Node with the
// installed @huggingface/transformers, using the files fetched by scripts/fetch-models.mjs.
//
//   node scripts/probe/embed-probe.mjs [--dtype q8|fp32] [--models <dir>] [--n 32]
//
// Prints: load time, dims, a cosine matrix over 3 sentences, ms per batch of N texts, and the exact
// options that worked (copy them into src/main/worker for the `minilm` EmbeddingProvider).

import { existsSync } from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { env, pipeline } from '@huggingface/transformers'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const argv = process.argv.slice(2)
const arg = (name, def) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def
}
const MODEL_ID = 'Xenova/all-MiniLM-L6-v2'
const MODELS_DIR = path.resolve(arg('--models', path.join(ROOT, 'build', 'models')))
const DTYPE = arg('--dtype', 'q8') // q8 -> onnx/model_quantized.onnx ; fp32 -> onnx/model.onnx
const N = Number(arg('--n', '32'))

for (const f of [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'onnx/model_quantized.onnx'
]) {
  const p = path.join(MODELS_DIR, MODEL_ID, f)
  if (!existsSync(p)) {
    console.error(`missing ${p} — run: node scripts/fetch-models.mjs`)
    process.exit(2)
  }
}

// Offline configuration: only read from MODELS_DIR, never hit the hub, no browser cache.
env.allowRemoteModels = false
env.allowLocalModels = true
env.localModelPath = MODELS_DIR
env.useBrowserCache = false
// Optional: env.backends.onnx.wasm is irrelevant in Node (onnxruntime-node is used).

const PIPELINE_OPTIONS = { dtype: DTYPE, device: 'cpu', local_files_only: true }
const CALL_OPTIONS = { pooling: 'mean', normalize: true }

console.log(`transformers.js: ${env.version}`)
console.log(`node: ${process.version} arch=${process.arch}`)
console.log(`models dir: ${MODELS_DIR}`)
console.log(`pipeline('feature-extraction', '${MODEL_ID}', ${JSON.stringify(PIPELINE_OPTIONS)})`)

const t0 = performance.now()
const extractor = await pipeline('feature-extraction', MODEL_ID, PIPELINE_OPTIONS)
const loadMs = Math.round(performance.now() - t0)
console.log(`model loaded in ${loadMs} ms`)

const sentences = [
  'PagedAttention manages the KV cache in fixed-size blocks so vLLM can serve many requests without memory fragmentation.',
  'Continuous batching keeps the GPU busy by admitting new requests as soon as a slot frees up in the inference server.',
  'A recipe for sourdough bread with a long cold ferment and a very hot Dutch oven.'
]

const t1 = performance.now()
const out = await extractor(sentences, CALL_OPTIONS)
const firstMs = Math.round(performance.now() - t1)
const [rows, dims] = out.dims
console.log(`embedded ${rows} sentences in ${firstMs} ms (first call, includes warm-up); dims=${dims}`)

const vec = (i) => out.data.subarray(i * dims, (i + 1) * dims)
const dot = (a, b) => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}
const norm = (a) => Math.sqrt(dot(a, a))
console.log(`norm of vector 0 (expect ~1.0 with normalize:true): ${norm(vec(0)).toFixed(4)}`)
console.log('cosine matrix:')
for (let i = 0; i < rows; i++) {
  console.log(`  [${i}] ${sentences.map((_, j) => dot(vec(i), vec(j)).toFixed(3)).join('  ')}`)
}
console.log(
  `cos(0,1) [both inference]=${dot(vec(0), vec(1)).toFixed(3)}  cos(0,2) [inference vs bread]=${dot(vec(0), vec(2)).toFixed(3)}`
)

// Throughput: N realistic ~900-char chunks (the architecture's body chunk size; MiniLM truncates at 256 wordpieces).
const chunk = (i) =>
  `Chunk ${i}. ${sentences[i % 3]} The scheduler admits requests based on predicted output length and preempts by recompute or swap. ` +
  'Prefix caching shares system-prompt blocks across sequences. Time to first token stayed under 350 ms in the internal benchmark while throughput rose from 410 to 1,180 tokens per second on a single 80 GB card. '.repeat(
    4
  )
const texts = Array.from({ length: N }, (_, i) => chunk(i))
console.log(`avg chunk length: ${Math.round(texts.reduce((a, t) => a + t.length, 0) / texts.length)} chars`)

const runs = []
for (let r = 0; r < 3; r++) {
  const t = performance.now()
  await extractor(texts, CALL_OPTIONS)
  runs.push(Math.round(performance.now() - t))
}
console.log(
  `batch of ${N} long chunks: ${runs.join(' / ')} ms (3 runs) -> ${(Math.min(...runs) / N).toFixed(1)} ms/text best`
)

// Also measure one-at-a-time (how the worker may embed a single summary document).
const single = []
for (let r = 0; r < 5; r++) {
  const t = performance.now()
  await extractor([texts[r]], CALL_OPTIONS)
  single.push(Math.round(performance.now() - t))
}
console.log(`single long chunk: ${single.join(' / ')} ms`)

const tShort = performance.now()
await extractor(
  Array.from({ length: N }, (_, i) => sentences[i % 3]),
  CALL_OPTIONS
)
console.log(`batch of ${N} short sentences: ${Math.round(performance.now() - tShort)} ms`)

console.log('\nOPTIONS THAT WORKED:')
console.log(
  JSON.stringify(
    {
      env: { allowRemoteModels: false, allowLocalModels: true, localModelPath: MODELS_DIR, useBrowserCache: false },
      pipeline: ['feature-extraction', MODEL_ID, PIPELINE_OPTIONS],
      call: CALL_OPTIONS,
      loadMs,
      dims
    },
    null,
    2
  )
)
