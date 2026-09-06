import { type BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import type { Collection, ContextMenuKind, Item } from '../../shared/types'

/**
 * Action ids returned to the renderer from `system:contextMenu`. The renderer performs the action
 * (it owns selection, undo toasts and navigation); main only shows the native menu.
 */
export type ContextMenuAction =
  | 'open'
  | 'open-url'
  | 'reveal'
  | 'quick-look'
  | 'copy-link'
  | 'reprocess'
  | 'trash'
  | 'restore'
  | 'delete-forever'
  | 'new-collection'
  | 'compare'
  | 'common'
  | 'summarize'
  | 'brief'
  | 'rename-collection'
  | 'delete-collection'
  | 'remove-from-collection'
  | 'paste'
  | 'add-files'
  | 'select-all'
  | `add-to-collection:${string}`

export type MenuEntry =
  | { type: 'separator' }
  | { label: string; action?: ContextMenuAction; enabled?: boolean; submenu?: MenuEntry[] }

export interface ContextMenuInput {
  kind: ContextMenuKind
  items: Pick<Item, 'id' | 'type' | 'deletedAt' | 'url' | 'isMissing'>[]
  collections: Pick<Collection, 'id' | 'name'>[]
  /** The collection the view is showing (enables "Remove from collection"). */
  collectionId?: string | undefined
}

function addToCollectionMenu(collections: ContextMenuInput['collections']): MenuEntry {
  const entries: MenuEntry[] = collections.map((c) => ({ label: c.name, action: `add-to-collection:${c.id}` as const }))
  if (entries.length > 0) entries.push({ type: 'separator' })
  entries.push({ label: 'New Collection…', action: 'new-collection' })
  return { label: 'Add to Collection', submenu: entries }
}

export function buildContextMenu(input: ContextMenuInput): MenuEntry[] {
  const { kind, items, collections, collectionId } = input
  switch (kind) {
    case 'item': {
      const item = items[0]
      if (!item) return []
      if (item.deletedAt) {
        return [
          { label: 'Restore', action: 'restore' },
          { type: 'separator' },
          { label: 'Delete Forever', action: 'delete-forever' }
        ]
      }
      const isUrl = item.type === 'url'
      const hasFile = !isUrl && !item.isMissing
      const entries: MenuEntry[] = [
        isUrl ? { label: 'Open Link', action: 'open-url' } : { label: 'Open', action: 'open', enabled: hasFile },
        { label: 'Quick Look', action: 'quick-look', enabled: hasFile },
        { label: 'Reveal in Finder', action: 'reveal', enabled: hasFile }
      ]
      if (item.url) entries.push({ label: 'Copy Link', action: 'copy-link' })
      entries.push({ type: 'separator' }, addToCollectionMenu(collections))
      if (collectionId) entries.push({ label: 'Remove from Collection', action: 'remove-from-collection' })
      entries.push(
        { type: 'separator' },
        { label: 'Try Again', action: 'reprocess' },
        { type: 'separator' },
        { label: 'Move to Trash', action: 'trash' }
      )
      return entries
    }
    case 'items': {
      if (items.some((i) => i.deletedAt)) {
        return [
          { label: 'Restore', action: 'restore' },
          { type: 'separator' },
          { label: 'Delete Forever', action: 'delete-forever' }
        ]
      }
      const entries: MenuEntry[] = [
        { label: 'Compare', action: 'compare' },
        { label: 'What do these have in common?', action: 'common' },
        { label: 'Summarize', action: 'summarize' },
        { label: 'Turn into a Brief', action: 'brief' },
        { type: 'separator' },
        addToCollectionMenu(collections)
      ]
      if (collectionId) entries.push({ label: 'Remove from Collection', action: 'remove-from-collection' })
      entries.push({ type: 'separator' }, { label: 'Move to Trash', action: 'trash' })
      return entries
    }
    case 'collection':
      return [
        { label: 'Edit', action: 'rename-collection' },
        { type: 'separator' },
        { label: 'Delete Collection', action: 'delete-collection' }
      ]
    case 'background':
      return [
        { label: 'Paste', action: 'paste' },
        { label: 'Add Files…', action: 'add-files' },
        { type: 'separator' },
        { label: 'New Collection…', action: 'new-collection' },
        { type: 'separator' },
        { label: 'Select All', action: 'select-all' }
      ]
  }
}

function toElectron(entries: MenuEntry[], resolve: (action: ContextMenuAction) => void): MenuItemConstructorOptions[] {
  return entries.map((entry) => {
    if ('type' in entry) return { type: 'separator' }
    const item: MenuItemConstructorOptions = { label: entry.label }
    if (entry.enabled === false) item.enabled = false
    if (entry.submenu) item.submenu = toElectron(entry.submenu, resolve)
    if (entry.action) {
      const action = entry.action
      item.click = () => resolve(action)
    }
    return item
  })
}

/**
 * Show a native context menu and resolve with the chosen action (or `{}` when dismissed). The
 * `callback` fires on close before a click handler can run, hence the `setTimeout` fallback.
 */
export function showContextMenu(input: ContextMenuInput, window: BrowserWindow | null): Promise<{ action?: string }> {
  const entries = buildContextMenu(input)
  if (entries.length === 0) return Promise.resolve({})
  return new Promise((resolve) => {
    let settled = false
    const done = (result: { action?: string }): void => {
      if (settled) return
      settled = true
      resolve(result)
    }
    const menu = Menu.buildFromTemplate(toElectron(entries, (action) => done({ action })))
    menu.popup({
      ...(window ? { window } : {}),
      callback: () => setTimeout(() => done({}), 150)
    })
  })
}
