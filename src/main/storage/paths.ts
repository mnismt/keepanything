import { isAbsolute, join, relative, sep } from 'node:path'
import type { MediaRoot, ParsedMediaUrl } from '../../shared/media'
import { ensureDirSync } from '../lib/fs'
import type { Paths } from '../ports'

/**
 * Library layout under `userData`. The caller passes `app.getPath('userData')`
 * and, when packaged, `<resourcesPath>/models`.
 */
export function buildPaths(userData: string, resourcesModelsDir?: string): Paths {
  const paths: Paths = {
    userData,
    dbFile: join(userData, 'library.db'),
    objectsDir: join(userData, 'objects'),
    thumbsDir: join(userData, 'thumbs'),
    snapshotsDir: join(userData, 'snapshots'),
    contentDir: join(userData, 'content'),
    modelsDir: join(userData, 'models'),
    logsDir: join(userData, 'logs'),
    urlCacheDir: join(userData, 'url-cache')
  }
  if (resourcesModelsDir) paths.resourcesModelsDir = resourcesModelsDir
  return paths
}

/** Create every library directory (idempotent). */
export function ensureLibraryDirs(paths: Paths): void {
  for (const dir of [
    paths.userData,
    paths.objectsDir,
    paths.thumbsDir,
    paths.snapshotsDir,
    paths.contentDir,
    paths.modelsDir,
    paths.logsDir,
    paths.urlCacheDir
  ]) {
    ensureDirSync(dir)
  }
}

/** Absolute path of the config file (settings + encrypted secrets). */
export function configFile(paths: Paths): string {
  return join(paths.userData, 'config.json')
}

/** Directory behind a `ka-media://` root. */
export function mediaRootDir(paths: Paths, root: MediaRoot): string {
  switch (root) {
    case 'objects':
      return paths.objectsDir
    case 'thumbs':
      return paths.thumbsDir
    case 'snapshots':
      return paths.snapshotsDir
    case 'content':
      return paths.contentDir
  }
}

/**
 * Absolute file path for a parsed `ka-media://` URL, or null when it would escape its root
 * (`path.relative` traversal check).
 */
export function resolveMediaPath(paths: Paths, parsed: ParsedMediaUrl): string | null {
  const rootDir = mediaRootDir(paths, parsed.root)
  const abs = join(rootDir, ...parsed.relPath.split('/'))
  const rel = relative(rootDir, abs)
  if (rel.length === 0 || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) return null
  return abs
}
