import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Item } from '../../../shared/types'
import { KaError } from '../../core/errors'
import { pathExistsSync } from '../../lib/fs'
import type { HandlerMap } from '../router'
import type { HandlerDeps } from './deps'

type ItemHandlers = Pick<
  HandlerMap,
  | 'items:list'
  | 'items:get'
  | 'items:update'
  | 'items:trash'
  | 'items:restore'
  | 'items:deleteForever'
  | 'items:reprocess'
  | 'items:reprocessAll'
  | 'items:openOriginal'
  | 'items:revealInFinder'
  | 'items:quickLook'
  | 'items:openUrl'
  | 'items:readContent'
>

/** How long a missing-file check is trusted before re-stat'ing (ms). */
const MISSING_CHECK_TTL_MS = 60_000

/** Absolute path of the bytes behind an item: managed copy first, referenced original second. */
export function itemFilePath(item: Item, deps: Pick<HandlerDeps, 'objectStore' | 'paths'>): string | null {
  if (item.type === 'note' && item.managedPath) return join(deps.paths.contentDir, item.managedPath)
  if (item.managedPath) {
    try {
      const abs = deps.objectStore.resolve(item.managedPath)
      if (pathExistsSync(abs)) return abs
    } catch {
      // fall through to the original
    }
  }
  if (item.originalPath && pathExistsSync(item.originalPath)) return item.originalPath
  return null
}

export function createItemHandlers(deps: HandlerDeps): ItemHandlers {
  const { items } = deps

  /** Refresh the `is_missing` cache when stale, then return the item. */
  const withMissingCheck = (item: Item): Item => {
    if (item.type === 'url' || (!item.managedPath && !item.originalPath)) return item
    const checkedAt = item.missingCheckedAt ? Date.parse(item.missingCheckedAt) : 0
    if (deps.clock.now().getTime() - checkedAt < MISSING_CHECK_TTL_MS) return item
    const missing = itemFilePath(item, deps) === null
    return items.setMissing(item.id, missing)
  }

  const requireFile = (id: string): string => {
    const item = withMissingCheck(items.get(id))
    const path = itemFilePath(item, deps)
    if (!path) throw new KaError('NOT_FOUND', 'Original moved or deleted.')
    return path
  }

  return {
    'items:list': (payload) => items.list(payload),
    'items:get': ({ id }) => {
      withMissingCheck(items.get(id))
      return items.detail(id)
    },
    'items:update': ({ id, patch }) => items.updateByUser(id, patch),
    'items:trash': ({ ids }) => {
      items.trash(ids)
    },
    'items:restore': ({ ids }) => {
      items.restore(ids)
    },
    'items:deleteForever': async ({ ids }) => {
      const removed = items.deleteForever(ids)
      for (const item of removed) {
        await deps.objectStore
          .removeItem(item.id)
          .catch((error: unknown) => deps.logger.warn('could not purge objects', { id: item.id, error }))
      }
    },
    'items:reprocess': ({ id, from }) => {
      items.reprocess(id, from)
    },
    'items:reprocessAll': ({ from }) => ({ count: items.reprocessAll(from) }),
    'items:openOriginal': async ({ id }) => {
      const item = items.get(id)
      if (item.type === 'url' && item.url) {
        await deps.desktop.openExternal(item.url)
        return
      }
      await deps.desktop.openPath(requireFile(id))
    },
    'items:revealInFinder': ({ id }) => {
      deps.desktop.showItemInFolder(requireFile(id))
    },
    'items:quickLook': async ({ id }) => {
      await deps.desktop.quickLook(requireFile(id))
    },
    'items:openUrl': async ({ id }) => {
      const item = items.get(id)
      const url = item.url ?? (typeof item.metadata.sourceUrl === 'string' ? item.metadata.sourceUrl : null)
      if (!url) throw new KaError('NOT_FOUND', 'This item has no link.')
      await deps.desktop.openExternal(url)
    },
    'items:readContent': async ({ id }) => {
      const item = items.get(id)
      const path = itemFilePath(item, deps)
      const isMarkdown = item.type === 'note' || item.type === 'markdown'
      if (path && (isMarkdown || item.type === 'text')) {
        try {
          const content = await readFile(path, 'utf8')
          return isMarkdown ? { markdown: content } : { text: content }
        } catch (error) {
          deps.logger.warn('could not read item content', { id, error })
        }
      }
      // Extraction writes the full body of other types to `content/<id>.(md|txt)` (see `metadata.content`).
      const ref = item.metadata.content
      if (ref && typeof ref === 'object' && typeof (ref as { path?: unknown }).path === 'string') {
        const { path: name, kind } = ref as { path: string; kind?: string }
        try {
          const content = await readFile(join(deps.paths.contentDir, name), 'utf8')
          return kind === 'markdown' ? { markdown: content } : { text: content }
        } catch (error) {
          deps.logger.warn('could not read extracted content', { id, error })
        }
      }
      if (item.extractedText) return isMarkdown ? { markdown: item.extractedText } : { text: item.extractedText }
      return {}
    }
  }
}
