/**
 * Route (`?view=library|shelf`), current sidebar section, modal stack
 * (`detail < dialog < palette`), palette state and the resolved theme.
 */
import { create } from 'zustand'
import type { ItemsView, ResolvedTheme } from '../../../shared/types'

export type Route = 'library' | 'shelf'

/** Sidebar sections; `ItemsView` ones map straight to `items:list`. */
export type Section = ItemsView | 'collections'

export type Modal =
  | { kind: 'detail'; itemId: string; originId?: string }
  | {
      kind: 'dialog'
      id: 'settings' | 'newCollection' | 'renameCollection' | 'deleteCollection'
      collectionId?: string
    }
  | { kind: 'palette' }

export interface UiState {
  route: Route
  section: Section
  collectionId: string | null
  modalStack: Modal[]
  theme: ResolvedTheme
  /** Prefill for the palette input (e.g. from the Toolbar search button). */
  paletteQuery: string
  /** Run the palette should show on open (SelectionBar / context-menu commands hand off here). */
  paletteRunId: string | null
  /** Set while an external drag hovers the window. */
  dragOver: boolean

  setSection: (section: Section, collectionId?: string | null) => void
  push: (modal: Modal) => void
  pop: () => Modal | undefined
  closeAll: () => void
  openDetail: (itemId: string, originId?: string) => void
  closeDetail: () => void
  openSettings: () => void
  openPalette: (query?: string) => void
  /** Open the palette straight into a run (question is shown as the header). */
  openRun: (runId: string, question?: string) => void
  closePalette: () => void
  togglePalette: () => void
  setTheme: (theme: ResolvedTheme) => void
  setDragOver: (over: boolean) => void
}

/** Route from the location search: `?view=shelf` -> shelf, everything else -> library. */
export function routeFromSearch(search: string): Route {
  const view = new URLSearchParams(search).get('view')
  return view === 'shelf' ? 'shelf' : 'library'
}

const MODAL_RANK: Record<Modal['kind'], number> = { detail: 0, dialog: 1, palette: 2 }

export const useUi = create<UiState>((set, get) => ({
  route: typeof window !== 'undefined' ? routeFromSearch(window.location.search) : 'library',
  section: 'library',
  collectionId: null,
  modalStack: [],
  theme: 'dark',
  paletteQuery: '',
  paletteRunId: null,
  dragOver: false,

  setSection(section, collectionId = null) {
    set({ section, collectionId, modalStack: get().modalStack.filter((m) => m.kind === 'palette') })
  },

  push(modal) {
    set((s) => {
      // One of each kind; stack ordered by rank so Esc pops the topmost surface.
      const rest = s.modalStack.filter((m) => m.kind !== modal.kind)
      return { modalStack: [...rest, modal].sort((a, b) => MODAL_RANK[a.kind] - MODAL_RANK[b.kind]) }
    })
  },

  pop() {
    const stack = get().modalStack
    const top = stack[stack.length - 1]
    if (top) set({ modalStack: stack.slice(0, -1) })
    return top
  },

  closeAll() {
    set({ modalStack: [] })
  },

  openDetail(itemId, originId) {
    get().push(originId ? { kind: 'detail', itemId, originId } : { kind: 'detail', itemId })
  },

  closeDetail() {
    set((s) => ({ modalStack: s.modalStack.filter((m) => m.kind !== 'detail') }))
  },

  openSettings() {
    get().push({ kind: 'dialog', id: 'settings' })
  },

  openPalette(query = '') {
    set({ paletteQuery: query, paletteRunId: null })
    get().push({ kind: 'palette' })
  },

  openRun(runId, question = '') {
    set({ paletteQuery: question, paletteRunId: runId })
    get().push({ kind: 'palette' })
  },

  closePalette() {
    set((s) => ({ modalStack: s.modalStack.filter((m) => m.kind !== 'palette') }))
  },

  togglePalette() {
    const open = get().modalStack.some((m) => m.kind === 'palette')
    if (open) get().closePalette()
    else get().openPalette()
  },

  setTheme(theme) {
    set({ theme })
    if (typeof document !== 'undefined') document.documentElement.dataset.theme = theme
  },

  setDragOver(over) {
    if (get().dragOver !== over) set({ dragOver: over })
  }
}))

export function selectTopModal(s: UiState): Modal | undefined {
  return s.modalStack[s.modalStack.length - 1]
}

export function isOpen(s: UiState, kind: Modal['kind']): boolean {
  return s.modalStack.some((m) => m.kind === kind)
}
