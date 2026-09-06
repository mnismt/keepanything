/**
 * MiniMax-M3 on GMI does not enforce `response_format`, so the JSON contract lives in the prompt and
 * the answer is extracted (raw -> last fence -> balanced object) and validated with zod. Truncation
 * (`finish_reason: 'length'`) retries once with doubled `max_tokens`; a validation failure retries
 * once with the zod error fed back.
 */

import { LIMITS } from '../../shared/constants'
import { KaError } from '../core/errors'
import type {
  AIProvider,
  AssistantMessage,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  StructuredSchema,
  Usage
} from '../ports'
import { appendToLastUserMessage, hasUnclosedThink, stripThink, userMessage } from './messages'
import { formatZodError } from './schemas/common'

/** Default `max_tokens` for structured calls (≥ 8k). */
export const STRUCTURED_MAX_TOKENS = 8_192
export const STRUCTURED_MAX_TOKENS_CAP = 16_384

export interface StructuredOptions {
  defaultMaxTokens?: number
  maxTokensCap?: number
}

/** User-facing message when the model never produced usable JSON. */
export const STRUCTURED_FAILURE_MESSAGE = "Couldn't make sense of the model's answer. Try again in a moment."

/**
 * The JSON contract appended to the last user message. Byte-stable for a given schema so repeated
 * calls share the same suffix (the prefix cache covers system + tools; this is after the content).
 */
export function buildStructuredContract<T>(schema: StructuredSchema<T>): string {
  const name = schema.name ?? 'Result'
  const keys = topLevelKeys(schema)
  const lines = [
    `Respond with a single JSON object${keys.length > 0 ? ` with exactly these keys: ${keys.join(', ')}` : ''}.`,
    'Output only the JSON object: no markdown fences, no commentary before or after it.',
    'Use the allowed values verbatim where the schema lists them.'
  ]
  if (schema.jsonSchema) lines.push(`JSON schema "${name}":`, JSON.stringify(schema.jsonSchema))
  return lines.join('\n')
}

function topLevelKeys<T>(schema: StructuredSchema<T>): string[] {
  const properties = schema.jsonSchema?.properties
  if (typeof properties !== 'object' || properties === null) return []
  return Object.keys(properties as Record<string, unknown>)
}

/** Result of `extractJsonCandidates`: every parseable JSON object found, best first. */
export interface ExtractionResult {
  candidates: unknown[]
  /** Set when nothing parsed. */
  error?: string
}

const FENCE = /```([a-zA-Z0-9_-]*)[^\n]*\n([\s\S]*?)```/g

/**
 * Find JSON objects in model output: raw parse -> fenced blocks (last first, `json` first) -> balanced
 * `{…}` ending at the last `}`. Candidates are returned in order of preference; the caller picks the
 * first one the schema accepts.
 */
export function extractJsonCandidates(text: string): ExtractionResult {
  const cleaned = stripThink(text).trim()
  if (cleaned.length === 0) return { candidates: [], error: 'The response was empty.' }

  const candidates: unknown[] = []
  const push = (raw: string): boolean => {
    const value = tryParse(raw)
    if (value === undefined) return false
    candidates.push(value)
    return true
  }

  push(cleaned)

  const fences: { lang: string; body: string }[] = []
  for (const match of cleaned.matchAll(FENCE)) {
    fences.push({ lang: (match[1] ?? '').toLowerCase(), body: (match[2] ?? '').trim() })
  }
  const ordered = [...fences].reverse().sort((a, b) => Number(b.lang === 'json') - Number(a.lang === 'json'))
  for (const fence of ordered) push(fence.body)

  for (const slice of balancedObjectsFromEnd(cleaned)) push(slice)

  if (candidates.length === 0) {
    return { candidates, error: 'No JSON object could be parsed from the response.' }
  }
  return { candidates }
}

export function extractJson(text: string): unknown {
  return extractJsonCandidates(text).candidates[0]
}

function tryParse(raw: string): unknown | undefined {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined
  try {
    const value: unknown = JSON.parse(trimmed)
    return typeof value === 'object' && value !== null ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * Yield substrings `{…}` that end at the last `}` in the text and start at each earlier `{`, from the
 * outermost match inward. Brace counting is string-aware in the forward direction.
 */
function* balancedObjectsFromEnd(text: string): Generator<string> {
  const lastClose = text.lastIndexOf('}')
  if (lastClose === -1) return
  const opens: number[] = []
  let inString = false
  let escaped = false
  for (let i = 0; i <= lastClose; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') opens.push(i)
  }
  for (const start of opens) yield text.slice(start, lastClose + 1)
}

export type RepairResult = { value: Record<string, unknown> } | { error: string }

/**
 * Parse tool-call `arguments` leniently: `<think>` blocks and fences removed, trailing commas,
 * single-quoted strings, unquoted keys and unbalanced braces/brackets repaired. Empty input is `{}`.
 */
export function repairToolArguments(raw: string): RepairResult {
  const cleaned = stripThink(raw ?? '')
    .replace(/^```[a-zA-Z]*\s*/, '')
    .replace(/```\s*$/, '')
    .trim()
  if (cleaned.length === 0) return { value: {} }

  const direct = parseObject(cleaned)
  if (direct) return { value: direct }

  const start = cleaned.indexOf('{')
  let body = start === -1 ? `{${cleaned}` : cleaned.slice(start)
  body = quoteSingleQuotedStrings(body)
  body = body.replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$-]*)\s*:/g, '$1"$2":')
  body = body.replace(/,\s*([}\]])/g, '$1')
  body = closeUnbalanced(body)
  body = body.replace(/,\s*([}\]])/g, '$1')

  const repaired = parseObject(body)
  if (repaired) return { value: repaired }
  return { error: 'Tool arguments were not valid JSON.' }
}

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/** Convert `'text'` strings to `"text"` outside of existing double-quoted strings. */
function quoteSingleQuotedStrings(text: string): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const ch = text[i] as string
    if (ch === '"') {
      const end = findStringEnd(text, i, '"')
      out += text.slice(i, end + 1)
      i = end + 1
      continue
    }
    if (ch === "'") {
      const end = findStringEnd(text, i, "'")
      const inner = text
        .slice(i + 1, end)
        .replace(/\\'/g, "'")
        .replace(/"/g, '\\"')
      out += `"${inner}"`
      i = end + 1
      continue
    }
    out += ch
    i++
  }
  return out
}

function findStringEnd(text: string, start: number, quote: string): number {
  let escaped = false
  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\') escaped = true
    else if (ch === quote) return i
  }
  return text.length
}

/** Close an open string and append missing `}` / `]` in the right order. */
function closeUnbalanced(text: string): string {
  const stack: string[] = []
  let inString = false
  let escaped = false
  for (const ch of text) {
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') stack.push('}')
    else if (ch === '[') stack.push(']')
    else if ((ch === '}' || ch === ']') && stack[stack.length - 1] === ch) stack.pop()
  }
  let out = text
  if (inString) out += '"'
  out = out.replace(/[,:]\s*$/, (m) => (m.trim() === ':' ? ':null' : ''))
  while (stack.length > 0) out += stack.pop()
  return out
}

export function addUsage(a: Usage, b: Usage): Usage {
  const total =
    (a.totalTokens ?? a.promptTokens + a.completionTokens) + (b.totalTokens ?? b.promptTokens + b.completionTokens)
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: total,
    latencyMs: a.latencyMs + b.latencyMs
  }
}

const ZERO_USAGE: Usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 }

/**
 * One structured call with the retry ladder. Provider errors (`KaError`) propagate
 * untouched; exhausting the retries throws `KaError('AI_UNAVAILABLE')` in product voice.
 */
export async function generateStructured<T>(
  provider: Pick<AIProvider, 'chat'>,
  schema: StructuredSchema<T>,
  req: ChatRequest,
  opts: StructuredOptions = {}
): Promise<{ value: T; usage: Usage }> {
  const cap = opts.maxTokensCap ?? STRUCTURED_MAX_TOKENS_CAP
  let maxTokens = Math.min(req.maxTokens ?? opts.defaultMaxTokens ?? STRUCTURED_MAX_TOKENS, cap)
  let messages = appendToLastUserMessage(req.messages, buildStructuredContract(schema))
  let usage: Usage = ZERO_USAGE
  let truncationRetries = 1
  let validationRetries = 1
  let lastError = ''

  for (let attempt = 1; attempt <= 3; attempt++) {
    const response: ChatResponse = await provider.chat({ ...req, messages, maxTokens, responseFormat: undefined })
    usage = addUsage(usage, response.usage)
    const content = response.message.content ?? ''

    if (response.finishReason === 'length' || hasUnclosedThink(content)) {
      lastError = 'The response was cut off.'
      if (truncationRetries-- > 0) {
        maxTokens = Math.min(maxTokens * 2, cap)
        messages = appendToLastUserMessage(
          req.messages,
          `${buildStructuredContract(schema)}\nBe concise: short sentences, no repetition.`
        )
        continue
      }
      break
    }

    const extraction = extractJsonCandidates(content)
    let failure = extraction.error ?? ''
    if (extraction.candidates.length > 0) {
      const outcome = firstValid(schema, extraction.candidates)
      if ('value' in outcome) return { value: outcome.value, usage }
      failure = outcome.error
    }

    lastError = failure
    if (validationRetries-- > 0) {
      // Echo the assistant message back so opaque reasoning survives the validation retry.
      const echoed: AssistantMessage = {
        ...response.message,
        content: content.length > 0 ? content : '(empty)'
      }
      messages = [
        ...messages,
        echoed,
        userMessage(`The JSON was invalid: ${failure}\nReturn the corrected JSON object only.`)
      ]
      continue
    }
    break
  }

  throw new KaError('AI_UNAVAILABLE', STRUCTURED_FAILURE_MESSAGE, {
    schema: schema.name,
    task: req.task,
    lastError,
    usage
  })
}

function firstValid<T>(schema: StructuredSchema<T>, candidates: unknown[]): { value: T } | { error: string } {
  let firstError = ''
  for (const candidate of candidates) {
    try {
      return { value: schema.parse(candidate) }
    } catch (error) {
      if (firstError.length === 0) firstError = formatZodError(error)
    }
  }
  return { error: firstError || 'The JSON did not match the schema.' }
}

/** Add `generateStructured` to a provider that only implements `chat`. */
export function withStructured(base: Pick<AIProvider, 'id' | 'model' | 'chat'>, opts?: StructuredOptions): AIProvider {
  return {
    get id() {
      return base.id
    },
    get model() {
      return base.model
    },
    chat: (req) => base.chat(req),
    generateStructured: (schema, req) => generateStructured(base, schema, req, opts)
  }
}

/** Messages a caller may inspect in tests: the contract appended to a copy of `messages`. */
export function messagesWithContract<T>(messages: ChatMessage[], schema: StructuredSchema<T>): ChatMessage[] {
  return appendToLastUserMessage(messages, buildStructuredContract(schema))
}

/** Default `max_tokens` for agentic (tool) calls. */
export const AGENT_MAX_TOKENS = STRUCTURED_MAX_TOKENS
/** Prompt-token ceiling per run (re-exported for the agent slice). */
export const RUN_PROMPT_TOKEN_CEILING = LIMITS.runPromptTokenCeiling
