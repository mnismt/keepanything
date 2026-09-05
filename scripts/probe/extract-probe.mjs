#!/usr/bin/env node
/**
 * Run the slice-3 extraction adapters against the demo fixtures (no Electron, no key).
 *
 *   node scripts/probe/extract-probe.mjs            # fixtures only, offline
 *   node scripts/probe/extract-probe.mjs --online   # also the URLs in tests/fixtures/corpus/files/urls.txt
 *
 * Bundles `extract-probe.src.ts` with esbuild (shipped with Vite) so the TypeScript sources can be
 * imported from a plain Node script; node_modules stay external.
 */
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const outfile = resolve(root, 'node_modules/.cache/keepanything/extract-probe.mjs')

await mkdir(dirname(outfile), { recursive: true })
await build({
  entryPoints: [resolve(here, 'extract-probe.src.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  packages: 'external',
  outfile,
  logLevel: 'silent'
})
process.env.KEEPANYTHING_PROBE_ROOT = root
await import(pathToFileURL(outfile).href)
