/**
 * Max 3, 6 s unless hovered, optional Undo / Show / Retry action plus an optional quieter
 * `secondary` one. ⌘Z triggers the newest toast with an Undo action (primary or secondary).
 * Timers live in the Toast component so hover can pause them.
 */
import { create } from 'zustand'

export interface ToastAction {
  label: 'Undo' | 'Show' | 'Retry' | 'Open'
  run: () => unknown
}

export interface Toast {
  id: string
  text: string
  /** Optional second line, quieter. */
  detail?: string
  action?: ToastAction
  /** Second, quieter action (e.g. Show next to Undo). */
  secondary?: ToastAction
  createdAt: number
  /** ms; default 6000. */
  ttl: number
}

export interface ToastsState {
  toasts: Toast[]
  push: (toast: Omit<Toast, 'id' | 'createdAt' | 'ttl'> & { ttl?: number }) => string
  dismiss: (id: string) => void
  /** Run and dismiss the newest toast whose action is Undo. Returns true when one existed. */
  undoNewest: () => boolean
}

export const MAX_TOASTS = 3
export const TOAST_TTL = 6_000

let seq = 0

export const useToasts = create<ToastsState>((set, get) => ({
  toasts: [],

  push(toast) {
    const id = `t${++seq}`
    const next: Toast = { ...toast, id, createdAt: Date.now(), ttl: toast.ttl ?? TOAST_TTL }
    set((s) => ({ toasts: [...s.toasts, next].slice(-MAX_TOASTS) }))
    return id
  },

  dismiss(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },

  undoNewest() {
    const undoOf = (t: Toast): ToastAction | undefined =>
      t.action?.label === 'Undo' ? t.action : t.secondary?.label === 'Undo' ? t.secondary : undefined
    const candidates = get().toasts.filter((t) => undoOf(t) !== undefined)
    const newest = candidates[candidates.length - 1]
    const undo = newest ? undoOf(newest) : undefined
    if (!newest || !undo) return false
    void undo.run()
    get().dismiss(newest.id)
    return true
  }
}))
