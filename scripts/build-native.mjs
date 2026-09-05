#!/usr/bin/env node
/**
 * Compile the drag-watch sidecar (`native/drag-watch/main.swift`) to `build/native/ka-drag-watch`.
 *
 * Shipped via electron-builder `extraResources`, like the embedding model files. Missing `swiftc`
 * is not fatal: the app falls back to opening the shelf from the menu-bar icon, ⌘⇧K and ⌘V.
 * Recompiles only when the source is newer than the binary, so `pnpm run dev` stays fast.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'native/drag-watch/main.swift')
const outDir = join(root, 'build/native')
const binary = join(outDir, 'ka-drag-watch')

/** Oldest macOS the binary must run on; matches what Electron 44 supports. */
const DEPLOYMENT_TARGET = 'arm64-apple-macos13.0'

const mtime = (path) => {
  try {
    return statSync(path).mtimeMs
  } catch {
    return 0
  }
}

if (mtime(binary) > mtime(source)) {
  console.log('native: ka-drag-watch is up to date')
  process.exit(0)
}

const swiftc = spawnSync('which', ['swiftc'], { encoding: 'utf8' })
if (swiftc.status !== 0) {
  console.warn('native: swiftc not found (install the Xcode command line tools).')
  console.warn('native: skipping the drag watcher; the shelf still opens from the menu bar, ⌘⇧K and ⌘V.')
  process.exit(0)
}

mkdirSync(outDir, { recursive: true })
const result = spawnSync(
  'swiftc',
  ['-O', '-whole-module-optimization', '-target', DEPLOYMENT_TARGET, '-o', binary, source],
  { stdio: 'inherit' }
)
if (result.status !== 0) {
  console.warn('native: could not build the drag watcher; continuing without it.')
  process.exit(0)
}
console.log(`native: built ${binary}`)
