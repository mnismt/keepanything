import type { SqlValue } from '../db'

/** Parse a JSON text column, returning `fallback` on null/invalid input. */
export function parseJson<T>(text: unknown, fallback: T): T {
  if (typeof text !== 'string' || text.length === 0) return fallback
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

/** Parse a JSON string array column. Non-string entries are dropped. */
export function parseStringArray(text: unknown): string[] {
  const value = parseJson<unknown>(text, [])
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

/** SQLite integer -> boolean. */
export function toBool(value: unknown): boolean {
  return value === 1 || value === true || value === 1n
}

export function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** Nullable numeric column (bigint-safe). */
export function num(value: unknown): number | null {
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  return null
}

/** Required numeric column with default. */
export function numOr(value: unknown, fallback: number): number {
  return num(value) ?? fallback
}

/** Required text column; throws on null so schema drift surfaces loudly. */
export function requireText(value: unknown, column: string): string {
  if (typeof value !== 'string') throw new Error(`Column ${column} unexpectedly null`)
  return value
}

export function json(value: unknown): string {
  return JSON.stringify(value ?? null)
}

/** `(?, ?, ?)` placeholder list for `IN` clauses. */
export function placeholders(n: number): string {
  return Array.from({ length: n }, () => '?').join(', ')
}

/** Split an id list into chunks below SQLite's parameter limit. */
export function chunk<T>(items: readonly T[], size = 400): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** Row shape returned by `node:sqlite` (`.get()`/`.all()`). */
export type Row = Record<string, SqlValue>
