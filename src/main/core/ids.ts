import { randomUUID } from 'node:crypto'

/** Id generator; injected so tests can produce deterministic ids. */
export type IdGenerator = () => string

/** UUID v4 ids for every row. */
export const uuid: IdGenerator = () => randomUUID()

/** Sequential ids (`prefix-1`, `prefix-2`, ...) for tests. */
export function sequentialIds(prefix = 'id'): IdGenerator {
  let n = 0
  return () => `${prefix}-${++n}`
}
