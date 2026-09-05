import { readdir, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { LIMITS, SKIP_DIR_NAMES } from '../../shared/constants'
import type { FolderMetadata } from '../../shared/types'

/**
 * Folder scanning shared by intake (shallow manifest at capture) and the folder extractor
 * (tree + samples). Bounded by `LIMITS.folderMaxFiles` / `folderMaxDepth`; skips build/cache dirs.
 */

export interface FolderEntry {
  /** Path relative to the folder root, `/`-separated. */
  rel: string
  size: number
  /** Lower-case extension without the dot ('' when none). */
  ext: string
  depth: number
}

/** A top-level entry as shown in the manifest. */
export interface TopLevelEntry {
  name: string
  kind: 'file' | 'dir'
  size: number
}

export interface FolderScan {
  fileCount: number
  dirCount: number
  totalBytes: number
  /** True when the caps stopped the scan early. */
  truncated: boolean
  extensions: Record<string, number>
  topLevel: TopLevelEntry[]
  files: FolderEntry[]
  /** Directories relative to root (for the tree), capped. */
  dirs: string[]
}

export interface ScanOptions {
  maxFiles?: number
  maxDepth?: number
  skipDirs?: readonly string[]
  maxTopLevel?: number
  signal?: AbortSignal
}

/** Walk a folder breadth-first within the limits. Never throws for unreadable subdirectories. */
export async function scanFolder(root: string, opts: ScanOptions = {}): Promise<FolderScan> {
  const maxFiles = opts.maxFiles ?? LIMITS.folderMaxFiles
  const maxDepth = opts.maxDepth ?? LIMITS.folderMaxDepth
  const skip = new Set(opts.skipDirs ?? SKIP_DIR_NAMES)
  const maxTopLevel = opts.maxTopLevel ?? 60
  const scan: FolderScan = {
    fileCount: 0,
    dirCount: 0,
    totalBytes: 0,
    truncated: false,
    extensions: {},
    topLevel: [],
    files: [],
    dirs: []
  }
  const queue: { abs: string; rel: string; depth: number }[] = [{ abs: root, rel: '', depth: 0 }]
  while (queue.length > 0) {
    if (opts.signal?.aborted) throw new Error('Folder scan cancelled')
    const dir = queue.shift() as { abs: string; rel: string; depth: number }
    let names: string[]
    try {
      names = (await readdir(dir.abs)).sort((a, b) => a.localeCompare(b))
    } catch {
      continue
    }
    for (const name of names) {
      if (name.startsWith('.') && name !== '.env.example') continue
      const abs = join(dir.abs, name)
      const rel = dir.rel ? `${dir.rel}/${name}` : name
      let stats: Awaited<ReturnType<typeof stat>>
      try {
        stats = await stat(abs)
      } catch {
        continue
      }
      if (stats.isDirectory()) {
        if (skip.has(name)) continue
        scan.dirCount += 1
        if (dir.depth === 0 && scan.topLevel.length < maxTopLevel) scan.topLevel.push({ name, kind: 'dir', size: 0 })
        if (scan.dirs.length < 400) scan.dirs.push(rel)
        if (dir.depth + 1 < maxDepth) queue.push({ abs, rel, depth: dir.depth + 1 })
        else scan.truncated = true
        continue
      }
      if (!stats.isFile()) continue
      if (scan.fileCount >= maxFiles) {
        scan.truncated = true
        continue
      }
      const ext = extname(name).slice(1).toLowerCase()
      scan.fileCount += 1
      scan.totalBytes += stats.size
      scan.extensions[ext || '(none)'] = (scan.extensions[ext || '(none)'] ?? 0) + 1
      scan.files.push({ rel, size: stats.size, ext, depth: dir.depth })
      if (dir.depth === 0 && scan.topLevel.length < maxTopLevel)
        scan.topLevel.push({ name, kind: 'file', size: stats.size })
    }
  }
  return scan
}

/** The `metadata.folder` value for a scan. */
export function folderMetadataFrom(scan: FolderScan, extra: Partial<FolderMetadata> = {}): FolderMetadata {
  const extensions = Object.fromEntries(
    Object.entries(scan.extensions)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 20)
  )
  return {
    fileCount: scan.fileCount,
    dirCount: scan.dirCount,
    totalBytes: scan.totalBytes,
    truncated: scan.truncated,
    extensions,
    ...extra
  }
}

/** Compact text tree of the scan (directories first, ≤ `maxLines`). */
export function renderTree(scan: FolderScan, rootName: string, maxLines = 120): string {
  const lines = [`${rootName}/`]
  const entries = [
    ...scan.dirs.map((d) => ({ rel: `${d}/`, depth: d.split('/').length - 1 })),
    ...scan.files.map((f) => ({ rel: f.rel, depth: f.depth }))
  ].sort((a, b) => a.rel.localeCompare(b.rel))
  for (const e of entries) {
    if (lines.length >= maxLines) {
      lines.push('…')
      break
    }
    const name = e.rel.replace(/\/$/, '').split('/').pop() ?? e.rel
    lines.push(`${'  '.repeat(e.depth + 1)}${name}${e.rel.endsWith('/') ? '/' : ''}`)
  }
  return lines.join('\n')
}
