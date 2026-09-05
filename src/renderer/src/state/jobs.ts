/**
 * Per-item pipeline progress from the scheduler (`jobs:progress`) for the status stack and card
 * pulses. Terminal statuses clear the entry.
 */
import { create } from 'zustand'
import { isTerminal } from '../../../shared/status'
import type { JobProgress } from '../../../shared/types'
import { invoke } from '../lib/ipc-client'

export interface JobsState {
  /** Latest progress per item id. */
  byItem: Record<string, JobProgress>
  /** Batch-level jobs (organize_batch, consolidate) by batch id. */
  byBatch: Record<string, JobProgress>
  load: () => Promise<void>
  applyProgress: (progress: JobProgress) => void
  inFlight: () => number
}

export const useJobs = create<JobsState>((set, get) => ({
  byItem: {},
  byBatch: {},

  async load() {
    const result = await invoke('jobs:status', undefined)
    if (!result.ok) return
    const byItem: Record<string, JobProgress> = {}
    const byBatch: Record<string, JobProgress> = {}
    for (const job of result.data) {
      if (job.itemId) byItem[job.itemId] = job
      else if (job.batchId) byBatch[job.batchId] = job
    }
    set({ byItem, byBatch })
  },

  applyProgress(progress) {
    set((s) => {
      if (progress.itemId) {
        const byItem = { ...s.byItem }
        const settled = progress.processingStatus ? isTerminal(progress.processingStatus) : false
        if (settled || progress.jobStatus === 'cancelled') delete byItem[progress.itemId]
        else byItem[progress.itemId] = progress
        return { byItem }
      }
      if (progress.batchId) {
        const byBatch = { ...s.byBatch }
        if (progress.jobStatus === 'done' || progress.jobStatus === 'cancelled' || progress.jobStatus === 'failed')
          delete byBatch[progress.batchId]
        else byBatch[progress.batchId] = progress
        return { byBatch }
      }
      return {}
    })
  },

  inFlight() {
    return Object.values(get().byItem).filter((j) => j.jobStatus === 'running' || j.jobStatus === 'queued').length
  }
}))
