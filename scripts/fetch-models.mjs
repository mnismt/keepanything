/**
 * Download the local embedding model (Xenova/all-MiniLM-L6-v2, q8) into build/models so it ships
 * with the app (electron-builder `extraResources`) and is seeded into <userData>/models.
 *
 * Usage: `pnpm run models:fetch` (or `node scripts/fetch-models.mjs [--force] [--verify]`).
 *
 * - Idempotent: a file is skipped when it exists and its hash matches the Hugging Face tree listing
 *   (git blob sha1 for regular files, sha256 for LFS files). Corrupt / truncated files are re-fetched.
 * - Resumable: interrupted downloads leave `<file>.part`; the next run continues with a Range request.
 * - Offline: when the hub is unreachable and every file exists with a non-zero size, exits 0 with a
 *   warning (hashes cannot be checked without the listing).
 * - Zero dependencies (Node >= 20, global fetch). Honours HF_TOKEN / HF_ENDPOINT if set.
 */
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2'
const FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'onnx/model_quantized.onnx'
]
const HUB = (process.env.HF_ENDPOINT || 'https://huggingface.co').replace(/\/+$/, '')
const BASE_URL = `${HUB}/${MODEL_ID}/resolve/main/`
const TREE_URL = `${HUB}/api/models/${MODEL_ID}/tree/main?recursive=true`
// Anchor on the repo root (scripts/..) so the destination does not depend on the caller's cwd.
const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = resolve(ROOT_DIR, 'build/models', MODEL_ID)
const FORCE = process.argv.includes('--force')
const VERIFY_ONLY = process.argv.includes('--verify')
const HEADERS = process.env.HF_TOKEN ? { authorization: `Bearer ${process.env.HF_TOKEN}` } : {}

const log = (msg) => console.log(`[models] ${msg}`)

/** Hash a file: git blob sha1 (`sha1("blob <size>\0" + bytes)`) or plain sha256. */
async function hashFile(file, algo) {
  const size = statSync(file).size
  const hash = createHash(algo === 'git-sha1' ? 'sha1' : 'sha256')
  if (algo === 'git-sha1') hash.update(`blob ${size}\0`)
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

/** Expected `{ size, algo, digest }` per file from the hub tree listing; null when offline. */
async function fetchManifest() {
  try {
    const res = await fetch(TREE_URL, { headers: HEADERS, signal: AbortSignal.timeout(20_000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const entries = await res.json()
    const manifest = {}
    for (const e of entries) {
      if (!FILES.includes(e.path)) continue
      manifest[e.path] = e.lfs
        ? { size: e.lfs.size ?? e.size, algo: 'sha256', digest: e.lfs.oid }
        : { size: e.size, algo: 'git-sha1', digest: e.oid }
    }
    return manifest
  } catch (error) {
    log(`warning: could not fetch tree listing (${error.message}); hash verification disabled`)
    return null
  }
}

async function verify(dest, expected) {
  if (!existsSync(dest)) return { ok: false, reason: 'missing' }
  const size = statSync(dest).size
  if (size === 0) return { ok: false, reason: 'empty' }
  if (!expected) return { ok: true, reason: 'exists (unverified)' }
  if (size !== expected.size) return { ok: false, reason: `size ${size} != ${expected.size}` }
  const digest = await hashFile(dest, expected.algo)
  if (digest !== expected.digest) return { ok: false, reason: `${expected.algo} mismatch` }
  return { ok: true, reason: `${expected.algo} ok` }
}

async function download(file, expected) {
  const dest = resolve(OUT_DIR, file)
  mkdirSync(dirname(dest), { recursive: true })
  const partial = `${dest}.part`
  const url = `${BASE_URL}${file}`

  let offset = 0
  if (existsSync(partial)) {
    offset = statSync(partial).size
    if (expected && offset >= expected.size) offset = 0
    if (offset === 0) unlinkSync(partial)
  }
  const headers = { ...HEADERS }
  if (offset > 0) headers.range = `bytes=${offset}-`
  log(`fetch  ${file}${offset ? ` (resume from ${offset} bytes)` : ''}`)

  const response = await fetch(url, { redirect: 'follow', headers, signal: AbortSignal.timeout(10 * 60_000) })
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`)
  }
  const append = offset > 0 && response.status === 206
  if (offset > 0 && !append) log(`server ignored Range for ${file}; restarting download`)
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(partial, { flags: append ? 'a' : 'w' }))
  } catch (error) {
    // Keep the partial file for resume unless it is clearly useless.
    if (!existsSync(partial) || statSync(partial).size === 0) {
      if (existsSync(partial)) unlinkSync(partial)
    }
    throw error
  }
  const check = await verify(partial, expected)
  if (!check.ok) {
    unlinkSync(partial)
    throw new Error(`Downloaded ${file} failed verification: ${check.reason}`)
  }
  renameSync(partial, dest)
  log(`wrote  ${file} (${statSync(dest).size} bytes, ${check.reason})`)
}

const manifest = await fetchManifest()
let failures = 0
for (const file of FILES) {
  const expected = manifest?.[file] ?? null
  const dest = resolve(OUT_DIR, file)
  const check = FORCE ? { ok: false, reason: 'forced' } : await verify(dest, expected)
  if (check.ok) {
    log(`skip   ${file} (${check.reason})`)
    continue
  }
  if (VERIFY_ONLY) {
    log(`BAD    ${file} (${check.reason})`)
    failures++
    continue
  }
  if (!manifest && !existsSync(dest)) {
    log(`offline and ${file} is missing`)
    failures++
    continue
  }
  if (existsSync(dest) && !check.ok && check.reason !== 'forced') log(`refetch ${file} (${check.reason})`)
  try {
    await download(file, expected)
  } catch (error) {
    log(`ERROR  ${file}: ${error.message}`)
    failures++
  }
}

if (failures) {
  console.error(`[models] ${failures} file(s) not ready in ${OUT_DIR}`)
  process.exit(1)
}
log(`ready: ${OUT_DIR}`)
