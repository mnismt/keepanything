/** Enum fields are lower-cased and trimmed before validation (closed-vocabulary misses are the most likely retry cause), numbers are coerced from strings, and every schema is wrapped into a `StructuredSchema` with a JSON Schema document the prompt shows to the model. */
import { z } from 'zod'
import type { JsonObject, StructuredSchema } from '../../ports'

/** Lower-case + trim + `-`/space -> `_` so `"macOS App"` still hits `macos_app`. */
export function normalizeEnumValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

/** Enum over a closed vocabulary with lenient input normalization. */
export function lenientEnum<const T extends readonly [string, ...string[]]>(values: T) {
  return z.preprocess(normalizeEnumValue, z.enum(values))
}

/** `0..1` confidence; strings and percentages (`"85%"`, `85`) are coerced. */
export const confidenceSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    const pct = trimmed.endsWith('%')
    const n = Number(pct ? trimmed.slice(0, -1) : trimmed)
    if (Number.isNaN(n)) return value
    return pct ? n / 100 : n
  }
  return value
}, z.coerce.number().min(0).max(1).catch(0.5))

/** Trimmed non-empty string. */
export const nonEmptyString = z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1))

/** Array of trimmed, de-duplicated, non-empty strings, capped at `max`; missing -> `[]`. */
export function stringList(max: number) {
  return z.preprocess(
    (value) => {
      const list = Array.isArray(value) ? value : typeof value === 'string' && value.length > 0 ? [value] : []
      const seen = new Set<string>()
      const out: string[] = []
      for (const entry of list) {
        if (typeof entry !== 'string') continue
        const trimmed = entry.trim()
        const key = trimmed.toLowerCase()
        if (trimmed.length === 0 || seen.has(key)) continue
        seen.add(key)
        out.push(trimmed)
        if (out.length === max) break
      }
      return out
    },
    z.array(z.string().min(1)).max(max)
  )
}

/** Array of values from a closed vocabulary; unknown ids are dropped instead of failing. */
export function lenientEnumList<const T extends readonly [string, ...string[]]>(values: T, max: number) {
  const known = new Set<string>(values)
  return z.preprocess(
    (value) => {
      const list = Array.isArray(value) ? value : []
      const out: string[] = []
      for (const entry of list) {
        const normalized = normalizeEnumValue(entry)
        if (typeof normalized === 'string' && known.has(normalized) && !out.includes(normalized)) out.push(normalized)
        if (out.length === max) break
      }
      return out
    },
    z.array(z.enum(values)).max(max)
  )
}

export interface DefineSchemaOptions {
  /** One-line description placed at the top of the JSON Schema. */
  description?: string
}

/**
 * Wrap a zod schema as a `StructuredSchema`. The JSON Schema is generated once (byte-stable, so the
 * prompt prefix stays cacheable server-side) with `$schema` removed to save tokens.
 */
export function defineSchema<T>(
  name: string,
  schema: z.ZodType<T, unknown>,
  opts: DefineSchemaOptions = {}
): StructuredSchema<T> & { zod: z.ZodType<T, unknown> } {
  const jsonSchema = z.toJSONSchema(schema, { io: 'output', unrepresentable: 'any' }) as JsonObject
  delete jsonSchema.$schema
  if (opts.description) jsonSchema.description = opts.description
  return {
    name,
    jsonSchema,
    zod: schema,
    parse(value: unknown): T {
      return schema.parse(value)
    }
  }
}

/** Compact, model-readable rendering of a zod error (used for the validation retry). */
export function formatZodError(error: unknown): string {
  if (error instanceof z.ZodError) return z.prettifyError(error)
  if (error instanceof Error) return error.message
  return String(error)
}
