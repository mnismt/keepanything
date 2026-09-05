import type { Clock } from '../ports'

/** Wall-clock implementation used in production. */
export const systemClock: Clock = {
  now: () => new Date(),
  nowIso: () => new Date().toISOString()
}

/** A clock that only moves when told to; for scheduler, backoff and batch-gate tests. */
export interface ManualClock extends Clock {
  advance(ms: number): void
  set(date: Date | string): void
}

/** Create a `ManualClock` starting at `start` (default: 2026-01-01T00:00:00Z). */
export function createManualClock(start: Date | string = '2026-01-01T00:00:00.000Z'): ManualClock {
  let current = new Date(start).getTime()
  return {
    now: () => new Date(current),
    nowIso: () => new Date(current).toISOString(),
    advance(ms) {
      current += ms
    },
    set(date) {
      current = new Date(date).getTime()
    }
  }
}
