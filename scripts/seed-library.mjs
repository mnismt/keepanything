#!/usr/bin/env node
/**
 * Fills a development library with generic placeholder content so layout work has something to look
 * at. Everything is generated into a temp directory and dropped through the real preload bridge
 * (`capture:drop`), so items go through the actual pipeline — extraction, thumbnails, embeddings and
 * the mock AI provider — rather than being written straight into SQLite.
 *
 * Nothing here is presentation copy: the notes, snippets and images are deliberately bland filler.
 * Build a real library by dropping real files into the app.
 *
 * Usage:
 *   pnpm run seed:library                # launch out/main/index.js against the E2E profile and seed
 *   pnpm run seed:library -- --reset     # wipe the profile first
 *   pnpm run seed:library -- --timeout 120
 *
 * `scripts/screenshot.mjs` imports `seedLibrary()` instead, to reuse the window it already launched.
 * Requires a build: `pnpm exec electron-vite build`.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { deflateSync } from 'node:zlib'

/** Where generated fixtures live. Kept between runs so `reference` imports stay valid. */
export const FIXTURE_DIR = join(tmpdir(), 'keepanything-seed-fixtures')

// Minimal PNG encoder (truecolour, 8-bit, no interlace)

const CRC_TABLE = Int32Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})

function crc32(buf) {
  let c = -1
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const head = Buffer.alloc(4)
  head.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([head, body, crc])
}

/** Encode `pixel(x, y) -> [r, g, b]` as a PNG buffer. */
export function encodePng(width, height, pixel) {
  const raw = Buffer.alloc(height * (width * 3 + 1))
  let o = 0
  for (let y = 0; y < height; y += 1) {
    raw[o] = 0 // filter: none
    o += 1
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixel(x, y)
      raw[o] = r
      raw[o + 1] = g
      raw[o + 2] = b
      o += 3
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/** Flat colour with a soft diagonal band, so cards are distinguishable at thumbnail size. */
function bandedImage(hex, width, height) {
  const n = Number.parseInt(hex.slice(1), 16)
  const base = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  return encodePng(width, height, (x, y) => {
    const d = Math.abs(x / width - y / height)
    const lift = d < 0.06 ? 34 : d < 0.12 ? 14 : 0
    return [Math.min(255, base[0] + lift), Math.min(255, base[1] + lift), Math.min(255, base[2] + lift)]
  })
}

// Placeholder corpus

const TEXT_FILES = [
  [
    'notes/reading-list.md',
    `# Reading list

Placeholder note used to give the development library a markdown item.

## Queue
- Sample entry one, kept short on purpose.
- Sample entry two, with a second line so the excerpt wraps.
- Sample entry three.

## Done
- Nothing yet. This file exists only so the library is not empty.
`
  ],
  [
    'notes/project-kickoff.md',
    `# Project kickoff

Generated placeholder. Replace by dropping real files into the app.

## Agenda
1. Scope
2. Milestones
3. Open questions

## Notes
Longer paragraph so the detail pane has body text to render, and so extraction produces an excerpt
rather than a single line. Nothing in this file refers to anything real.
`
  ],
  [
    'notes/weekly-summary.md',
    `# Weekly summary

Placeholder summary for layout work.

- Shipped: sample item A
- In progress: sample item B
- Blocked: sample item C

Second paragraph, present so the card preview has more than one line of text to lay out.
`
  ],
  [
    'snippets/query-notes.txt',
    `Placeholder snippet.

Two short paragraphs of filler so text items have a believable excerpt without carrying any real
content. Replace with your own captures.
`
  ],
  [
    'snippets/todo.txt',
    `- placeholder task one
- placeholder task two
- placeholder task three
`
  ],
  [
    'data/sample-results.csv',
    `name,run,value,unit
sample-a,1,120,ms
sample-a,2,118,ms
sample-b,1,240,ms
sample-b,2,236,ms
sample-c,1,95,ms
`
  ],
  // A folder item: dropped as a directory so the library renders a folder card with a file count.
  ['sample-folder/README.md', '# Sample folder\n\nPlaceholder folder so the library shows a folder card.\n'],
  ['sample-folder/config.yaml', 'placeholder: true\nitems: 3\nmode: sample\n'],
  ['sample-folder/notes.txt', 'Placeholder notes inside the sample folder.\n'],
  ['sample-folder/data.json', '{ "placeholder": true, "rows": [1, 2, 3] }\n']
]

const IMAGES = [
  ['screenshots/sample-wide.png', '#2b4c7e', 1200, 700],
  ['screenshots/sample-tall.png', '#4a3b6b', 620, 900],
  ['screenshots/sample-square.png', '#2f6b58', 800, 800]
]

/** Write the placeholder corpus into `dir`; returns the paths to drop (folders as one entry). */
export function writeFixtures(dir = FIXTURE_DIR) {
  rmSync(dir, { recursive: true, force: true })
  for (const [rel, body] of TEXT_FILES) {
    const abs = join(dir, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, body)
  }
  for (const [rel, hex, w, h] of IMAGES) {
    const abs = join(dir, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, bandedImage(hex, w, h))
  }
  return [
    ...TEXT_FILES.filter(([rel]) => !rel.startsWith('sample-folder/')).map(([rel]) => join(dir, rel)),
    join(dir, 'sample-folder'),
    ...IMAGES.map(([rel]) => join(dir, rel))
  ]
}

// Seeding

const TERMINAL = new Set(['READY', 'PARTIAL', 'EXTRACTION_FAILED', 'AI_FAILED'])

/** Invoke an IPC channel through the preload bridge; throws on an error envelope. */
async function invoke(page, channel, payload) {
  const env = await page.evaluate(([c, p]) => window.keepAnything.invoke(c, p), [channel, payload])
  if (env?.ok !== true) {
    const err = env?.error ?? { code: 'INTERNAL', message: 'no envelope' }
    throw new Error(`${channel} → ${err.code}: ${err.message}`)
  }
  return env.data
}

/**
 * Drop the placeholder corpus into the library behind `page` and wait for every item to settle.
 * No-op when the library already holds items, so it is safe to call on every launch.
 */
export async function seedLibrary(page, opts = {}) {
  const log = opts.log ?? ((m) => console.log(m))
  const timeoutMs = opts.timeoutMs ?? 120_000

  const existing = await invoke(page, 'items:list', { view: 'library', limit: 1 })
  if (existing.length > 0 && !opts.force) {
    log('library already has items; skipping seed')
    return { seeded: 0, skipped: true }
  }

  const files = writeFixtures(opts.dir)
  log(`dropping ${files.length} placeholder path(s) from ${opts.dir ?? FIXTURE_DIR}`)
  const { items } = await invoke(page, 'capture:drop', { files, source: 'library' })
  const ids = items.map((i) => i.id)
  log(`captured ${ids.length} item(s); waiting for them to settle`)

  const deadline = Date.now() + timeoutMs
  for (;;) {
    const summaries = await invoke(page, 'items:list', { view: 'library', limit: 500 })
    const mine = summaries.filter((s) => ids.includes(s.id))
    const settled = mine.filter((s) => TERMINAL.has(s.processingStatus))
    if (settled.length >= ids.length) {
      const ready = settled.filter((s) => s.processingStatus === 'READY').length
      log(`seeded ${ids.length} item(s) (${ready} READY)`)
      return { seeded: ids.length, ready, skipped: false }
    }
    if (Date.now() > deadline) {
      log(`timed out with ${settled.length}/${ids.length} settled; continuing anyway`)
      return { seeded: ids.length, ready: settled.length, skipped: false, timedOut: true }
    }
    await page.waitForTimeout(400)
  }
}

// Standalone

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const { _electron: electron } = await import('@playwright/test')
  const args = process.argv.slice(2)
  const option = (name, fallback) => {
    const i = args.indexOf(name)
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback
  }

  if (args.includes('--reset')) rmSync(join(tmpdir(), 'keepanything-e2e'), { recursive: true, force: true })

  const app = await electron.launch({
    args: [resolve('out/main/index.js')],
    env: { ...process.env, KEEPANYTHING_E2E: '1', KEEPANYTHING_AI: process.env.KEEPANYTHING_AI ?? 'mock' }
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(500)

  // macOS Electron emits `open-file` for path arguments, and `desktop/activation.ts` captures them:
  // an `electron <script>` launch imports its own bundle. Drop those before seeding.
  const root = resolve('.')
  const listed = await invoke(page, 'items:list', { view: 'library', limit: 500 })
  const stray = []
  for (const item of listed) {
    const detail = await invoke(page, 'items:get', { id: item.id })
    const original = detail.item.originalPath
    if (original && (original.startsWith(join(root, 'node_modules')) || original.startsWith(join(root, 'out'))))
      stray.push(item.id)
  }
  if (stray.length > 0) await invoke(page, 'items:deleteForever', { ids: stray })

  await seedLibrary(page, { timeoutMs: Number(option('--timeout', '120')) * 1000, force: args.includes('--force') })
  await app.close()
}
