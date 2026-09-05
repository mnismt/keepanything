/**
 * Sidebar list with counts; reloads on `collections:changed`.
 */
import { create } from 'zustand'
import type { CollectionSummary } from '../../../shared/types'
import type { Result } from '../lib/ipc-client'
import { invoke } from '../lib/ipc-client'

export interface CollectionsState {
  list: CollectionSummary[]
  loading: boolean
  loadedOnce: boolean
  load: () => Promise<void>
  create: (name: string, description?: string) => Promise<Result<CollectionSummary>>
  rename: (id: string, name: string, description?: string) => Promise<boolean>
  remove: (id: string) => Promise<boolean>
  addItems: (id: string, itemIds: string[]) => Promise<boolean>
  removeItem: (id: string, itemId: string) => Promise<boolean>
  byId: (id: string) => CollectionSummary | undefined
}

export const useCollections = create<CollectionsState>((set, get) => ({
  list: [],
  loading: false,
  loadedOnce: false,

  async load() {
    set({ loading: true })
    const result = await invoke('collections:list', undefined)
    if (result.ok) set({ list: result.data, loading: false, loadedOnce: true })
    else set({ loading: false, loadedOnce: true })
  },

  async create(name, description) {
    const result = await invoke('collections:create', description ? { name, description } : { name })
    if (!result.ok) return result
    await get().load()
    const summary = get().list.find((c) => c.id === result.data.id) ?? {
      ...result.data,
      count: 0,
      coverThumbnailUrls: []
    }
    return { ok: true, data: summary }
  },

  async rename(id, name, description) {
    const result = await invoke(
      'collections:rename',
      description !== undefined ? { id, name, description } : { id, name }
    )
    if (result.ok) void get().load()
    return result.ok
  },

  async remove(id) {
    const result = await invoke('collections:delete', { id })
    if (result.ok) void get().load()
    return result.ok
  },

  async addItems(id, itemIds) {
    const result = await invoke('collections:addItems', { id, itemIds })
    if (result.ok) void get().load()
    return result.ok
  },

  async removeItem(id, itemId) {
    const result = await invoke('collections:removeItem', { id, itemId })
    if (result.ok) void get().load()
    return result.ok
  },

  byId(id) {
    return get().list.find((c) => c.id === id)
  }
}))
