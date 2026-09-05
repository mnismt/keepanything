import { createWriteStream, type WriteStream } from 'node:fs'
import { join } from 'node:path'
import type { LogFields, Logger } from '../ports'
import { ensureDirSync } from './fs'

/** Log levels in ascending severity. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

/** Where a formatted JSON line goes. */
export type LogSink = (line: string, level: LogLevel) => void

export interface LoggerOptions {
  /** Minimum level written; default `info`. */
  level?: LogLevel
  /** Output targets; default: stderr. */
  sinks?: LogSink[]
  /** Extra literal secrets (e.g. the API key from the environment) that are always redacted. */
  secrets?: readonly string[]
  /** Clock for the `ts` field (tests). */
  now?: () => string
}

const REDACTED = '[redacted]'
/** Keys that hold secrets. Usage counters (`promptTokens`, `maxTokens`) are not secrets and stay visible. */
const SECRET_KEY_PATTERN = /(api[-_]?key|apikey|token(?!s\b)|secret|password|passwd|authorization|cookie|credential)/i
/** Values that look like API keys: `sk-...`, `gmi_...`, `key-...` followed by a long token. */
const SECRET_VALUE_PATTERN = /\b(sk|gmi|key)[-_][A-Za-z0-9_-]{8,}\b/g
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g

/** Redact a string value: literal secrets, key-shaped tokens, bearer headers. */
export function redactString(value: string, secrets: readonly string[]): string {
  let out = value
  for (const secret of secrets) {
    if (secret.length >= 4 && out.includes(secret)) out = out.split(secret).join(REDACTED)
  }
  return out.replace(SECRET_VALUE_PATTERN, REDACTED).replace(BEARER_PATTERN, `Bearer ${REDACTED}`)
}

/**
 * Deep-redact a value for logging: keys that look like secrets are replaced wholesale, string
 * values are scanned for key-shaped tokens, errors become `{ name, message, stack }`. Cycles are cut.
 */
export function redact(value: unknown, secrets: readonly string[], seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactString(value, secrets)
  if (typeof value !== 'object' || value === null) {
    return typeof value === 'bigint' ? value.toString() : value
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message, secrets),
      stack: value.stack ? redactString(value.stack, secrets) : undefined,
      ...('code' in value ? { code: (value as { code?: unknown }).code } : {})
    }
  }
  if (seen.has(value)) return '[circular]'
  seen.add(value)
  if (Array.isArray(value)) return value.map((v) => redact(v, secrets, seen))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY_PATTERN.test(k) && v !== null && v !== undefined ? REDACTED : redact(v, secrets, seen)
  }
  return out
}

export const stderrSink: LogSink = (line) => {
  process.stderr.write(`${line}\n`)
}

/** Sink appending to `<logsDir>/keepanything.log`. Write errors are swallowed. */
export function createFileSink(logsDir: string, fileName = 'keepanything.log'): LogSink & { close(): void } {
  let stream: WriteStream | null = null
  const open = (): WriteStream | null => {
    if (stream) return stream
    try {
      ensureDirSync(logsDir)
      stream = createWriteStream(join(logsDir, fileName), { flags: 'a' })
      stream.on('error', () => {
        stream = null
      })
      return stream
    } catch {
      return null
    }
  }
  const sink: LogSink = (line) => {
    open()?.write(`${line}\n`)
  }
  return Object.assign(sink, {
    close: () => {
      stream?.end()
      stream = null
    }
  })
}

/** Create the root logger. Child loggers share sinks, level and secrets and merge their fields. */
export function createLogger(options: LoggerOptions = {}): Logger {
  const minRank = LEVEL_RANK[options.level ?? 'info']
  const sinks = options.sinks ?? [stderrSink]
  const secrets = (options.secrets ?? []).filter((s) => s.length > 0)
  const now = options.now ?? (() => new Date().toISOString())

  const make = (scope: LogFields): Logger => {
    const write = (level: LogLevel, msg: string, fields?: LogFields): void => {
      if (LEVEL_RANK[level] < minRank) return
      const record = redact({ ts: now(), level, msg, ...scope, ...(fields ?? {}) }, secrets)
      let line: string
      try {
        line = JSON.stringify(record)
      } catch {
        line = JSON.stringify({ ts: now(), level, msg, unserializable: true })
      }
      for (const sink of sinks) {
        try {
          sink(line, level)
        } catch {
          // A failing sink must never take the app down.
        }
      }
    }
    return {
      debug: (msg, fields) => write('debug', msg, fields),
      info: (msg, fields) => write('info', msg, fields),
      warn: (msg, fields) => write('warn', msg, fields),
      error: (msg, fields) => write('error', msg, fields),
      child: (fields) => make({ ...scope, ...fields })
    }
  }
  return make({})
}

export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger
}
