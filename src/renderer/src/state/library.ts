/**
 * The items of the current view, filters, sort, selection and keyboard focus.
 * `items:changed` events are applied optimistically (summaries when main sent them, otherwise a
 * reload).
 */
import { create } from 'zustand'
import type { ItemsChangedEvent } from '../../../shared/ipc'
import { isTerminal } from '../../../shared/status'
import type { ItemSummary, ItemsSort, ItemsView, ItemType } from '../../../shared/types'
import { invoke } from '../lib/ipc-client'

export type Density = 'comfortable' | 'compact'
export type Layout = 'grid' | 'list'

export interface LibraryQuery {
  view: ItemsView
  collectionId: string | null
  types: ItemType[]
  sort: ItemsSort
}

export interface LibraryState {
  query: LibraryQuery
  layout: Layout
  density: Density
  /** Items by id (only those in the current view). */
  byId: Record<string, ItemSummary>
  order: string[]
  loading: boolean
  loadedOnce: boolean
  error: string | null
  selection: Set<string>
  /** Card with roving tabindex focus. */
  focusId: string | null
  /** Anchor of the last click for shift-range selection. */
  anchorId: string | null

  load: () => Promise<void>
  setView: (view: ItemsView, collectionId?: string | null) => void
  setTypes: (types: ItemType[]) => void
  setSort: (sort: ItemsSort) => void
  setLayout: (layout: Layout) => void
  setDensity: (density: Density) => void
  setFocus: (id: string | null) => void
  select: (id: string, mode?: 'replace' | 'toggle' | 'range') => void
  selectAll: () => void
  clearSelection: () => void
  applyItemsChanged: (event: ItemsChangedEvent) => void
  trash: (ids: string[]) => Promise<boolean>
  restore: (ids: string[]) => Promise<boolean>
  deleteForever: (ids: string[]) => Promise<boolean>
  reprocess: (id: string) => Promise<boolean>
  /** Items in display order (memo-friendly selector helper). */
  visible: () => ItemSummary[]
}

let loadSeq = 0

function sortIds(byId: Record<string, ItemSummary>, sort: ItemsSort): string[] {
  const rows = Object.values(byId)
  rows.sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title)
    const key = sort === 'created' ? 'createdAt' : 'capturedAt'
    return Date.parse(b[key]) - Date.parse(a[key])
  })
  return rows.map((r) => r.id)
}

/** Does `item` belong in the current view? Used for optimistic inserts from `items:changed`. */
export function belongsToView(item: ItemSummary, query: LibraryQuery): boolean {
  if (query.types.length > 0 && !query.types.includes(item.type)) return false
  switch (query.view) {
    case 'library':
      return item.parentItemId === null
    case 'inbox':
      return !isTerminal(item.processingStatus) || Date.parse(item.capturedAt) > Date.now() - 24 * 3_600_000
    case 'links':
      return item.type === 'url'
    case 'files':
      return item.type !== 'url' && item.type !== 'note'
    case 'collection':
      return query.collectionId !== null && item.collectionIds.includes(query.collectionId)
    case 'trash':
      return false
  }
}

export const useLibrary = create<LibraryState>((set, get) => ({
  query: { view: 'library', collectionId: null, types: [], sort: 'captured' },
  layout: 'grid',
  density: 'comfortable',
  byId: {},
  order: [],
  loading: false,
  loadedOnce: false,
  error: null,
  selection: new Set(),
  focusId: null,
  anchorId: null,

  async load() {
    const seq = ++loadSeq
    const { query } = get()
    set({ loading: true, error: null })
    const result = await invoke('items:list', {
      view: query.view,
      ...(query.collectionId ? { collectionId: query.collectionId } : {}),
      ...(query.types.length > 0 ? { types: query.types } : {}),
      sort: query.sort
    })
    if (seq !== loadSeq) return
    if (!result.ok) {
      set({ loading: false, loadedOnce: true, error: result.error.message })
      return
    }
    const byId: Record<string, ItemSummary> = {}
    for (const item of result.data) byId[item.id] = item
    const order = result.data.map((i) => i.id)
    const { selection, focusId } = get()
    const kept = new Set([...selection].filter((id) => byId[id]))
    set({
      byId,
      order,
      loading: false,
      loadedOnce: true,
      selection: kept,
      focusId: focusId && byId[focusId] ? focusId : null
    })
  },

  setView(view, collectionId = null) {
    const { query } = get()
    if (query.view === view && query.collectionId === collectionId) return
    set({
      query: { ...query, view, collectionId },
      selection: new Set(),
      focusId: null,
      anchorId: null,
      byId: {},
      order: [],
      loadedOnce: false
    })
    void get().load()
  },

  setTypes(types) {
    set((s) => ({ query: { ...s.query, types } }))
    void get().load()
  },

  setSort(sort) {
    set((s) => ({ query: { ...s.query, sort }, order: sortIds(s.byId, sort) }))
  },

  setLayout(layout) {
    set({ layout })
  },

  setDensity(density) {
    set({ density })
  },

  setFocus(id) {
    set({ focusId: id })
  },

  select(id, mode = 'replace') {
    const { selection, anchorId, order } = get()
    if (mode === 'replace') {
      set({ selection: new Set([id]), anchorId: id, focusId: id })
      return
    }
    if (mode === 'toggle') {
      const next = new Set(selection)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      set({ selection: next, anchorId: id, focusId: id })
      return
    }
    const from = order.indexOf(anchorId ?? id)
    const to = order.indexOf(id)
    if (from === -1 || to === -1) {
      set({ selection: new Set([id]), anchorId: id, focusId: id })
      return
    }
    const [a, b] = from < to ? [from, to] : [to, from]
    set({ selection: new Set([...selection, ...order.slice(a, b + 1)]), focusId: id })
  },

  selectAll() {
    set((s) => ({ selection: new Set(s.order) }))
  },

  clearSelection() {
    set({ selection: new Set() })
  },

  applyItemsChanged(event) {
    const { query, byId, order } = get()
    const inTrash = query.view === 'trash'
    const next = { ...byId }
    let nextOrder = [...order]
    let needsReload = false

    switch (event.reason) {
      case 'created':
      case 'updated':
      case 'restored': {
        if (!event.summaries) {
          needsReload = true
          break
        }
        for (const summary of event.summaries) {
          const belongs = !inTrash && belongsToView(summary, query)
          const present = Boolean(next[summary.id])
          if (belongs) {
            next[summary.id] = summary
            if (!present) nextOrder = [summary.id, ...nextOrder]
          } else if (present) {
            delete next[summary.id]
            nextOrder = nextOrder.filter((id) => id !== summary.id)
          } else if (inTrash && event.reason === 'restored') {
            needsReload = true
          }
        }
        if (event.reason === 'restored' && inTrash) {
          for (const id of event.ids) {
            delete next[id]
            nextOrder = nextOrder.filter((x) => x !== id)
          }
        }
        break
      }
      case 'trashed':
        if (inTrash) needsReload = true
        for (const id of event.ids) {
          if (!inTrash) {
            delete next[id]
            nextOrder = nextOrder.filter((x) => x !== id)
          }
        }
        break
      case 'deleted':
        for (const id of event.ids) {
          delete next[id]
          nextOrder = nextOrder.filter((x) => x !== id)
        }
        break
    }

    const selection = new Set([...get().selection].filter((id) => next[id]))
    const focusId = get().focusId && next[get().focusId as string] ? get().focusId : null
    set({
      byId: next,
      order: query.sort === 'captured' && event.reason === 'created' ? nextOrder : sortIds(next, query.sort),
      selection,
      focusId
    })
    if (needsReload) void get().load()
  },

  async trash(ids) {
    if (ids.length === 0) return false
    const result = await invoke('items:trash', { ids })
    if (result.ok) get().applyItemsChanged({ reason: 'trashed', ids })
    return result.ok
  },

  async restore(ids) {
    if (ids.length === 0) return false
    const result = await invoke('items:restore', { ids })
    if (result.ok) void get().load()
    return result.ok
  },

  async deleteForever(ids) {
    if (ids.length === 0) return false
    const result = await invoke('items:deleteForever', { ids })
    if (result.ok) get().applyItemsChanged({ reason: 'deleted', ids })
    return result.ok
  },

  async reprocess(id) {
    const result = await invoke('items:reprocess', { id })
    return result.ok
  },

  visible() {
    const { byId, order } = get()
    return order.map((id) => byId[id]).filter((i): i is ItemSummary => Boolean(i))
  }
}))

export function selectVisibleItems(s: LibraryState): ItemSummary[] {
  return s.order.map((id) => s.byId[id]).filter((i): i is ItemSummary => Boolean(i))
}
