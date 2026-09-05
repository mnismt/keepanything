#!/usr/bin/env node

// gmi-probe.mjs — measure the GMI Cloud OpenAI-compatible chat endpoint with MiniMax-M3.
//
//   node scripts/probe/gmi-probe.mjs [probe ...]
//   probes: baseline json sampling tools vision long concurrency streaming params followups   (default: all)
//
// Zero dependencies (Node >= 22, global fetch). Reads KEEPANYTHING_GMI_API_KEY and the optional
// KEEPANYTHING_GMI_BASE_URL / KEEPANYTHING_MODEL from the gitignored .env at the repo root.
// The key is never printed. Every string that is logged or written to disk passes through redact().
// Raw (redacted) records are written to /tmp/gmi-probe-results/<timestamp>/ for later inspection.
// Findings are summarised in docs/GMI_NOTES.md.

import { execFile } from 'node:child_process'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')

// .env + secrets
function parseEnvFile(text) {
  const out = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    else {
      const hash = v.indexOf(' #')
      if (hash >= 0) v = v.slice(0, hash).trim()
    }
    out[m[1]] = v
  }
  return out
}

const env = { ...parseEnvFile(await readFile(path.join(ROOT, '.env'), 'utf8').catch(() => '')), ...process.env }
const KEY = env.KEEPANYTHING_GMI_API_KEY
if (!KEY) {
  console.error('KEEPANYTHING_GMI_API_KEY is not set (expected in .env). Aborting.')
  process.exit(2)
}
const BASE_URL = (env.KEEPANYTHING_GMI_BASE_URL || 'https://api.gmi-serving.com/v1').replace(/\/+$/, '')
const MODEL = env.KEEPANYTHING_MODEL || 'MiniMaxAI/MiniMax-M3'

// Redact the key and its prefixes (>= 8 chars) from anything we print or persist.
const SECRETS = [KEY, KEY.slice(0, 24), KEY.slice(0, 16), KEY.slice(0, 8)].filter((s) => s && s.length >= 8)
function redact(value) {
  let s = typeof value === 'string' ? value : (JSON.stringify(value, null, 2) ?? String(value))
  for (const sec of SECRETS) s = s.split(sec).join('[REDACTED]')
  return s.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
}
const log = (...parts) => console.log(...parts.map((p) => (typeof p === 'string' ? redact(p) : redact(p))))

// HTTP helpers
const RECORDS = []
const STAMP = new Date().toISOString().replace(/[:.]/g, '-')
const OUT_DIR = path.join('/tmp', 'gmi-probe-results', STAMP)
await mkdir(OUT_DIR, { recursive: true })

const INTERESTING_HEADER =
  /ratelimit|rate-limit|retry-after|request-id|x-request|cf-ray|x-envoy|x-inference|x-gmi|^server$|^via$|x-served|x-model|x-process|x-upstream|^date$|content-type|x-.*time|x-trace/i
let printedAllHeaderNames = false
function pickHeaders(headers) {
  const all = {}
  for (const [k, v] of headers.entries()) all[k] = v
  if (!printedAllHeaderNames) {
    printedAllHeaderNames = true
    log(`  response header names (first request): ${Object.keys(all).join(', ')}`)
  }
  const out = {}
  for (const [k, v] of Object.entries(all)) if (INTERESTING_HEADER.test(k) && k !== 'set-cookie') out[k] = v
  return out
}

function msgOf(json) {
  return json?.choices?.[0]?.message ?? null
}
function reasoningOf(msg) {
  return msg?.reasoning_content ?? msg?.reasoning ?? msg?.reasoning_details ?? ''
}
function thinkTagsIn(content) {
  return typeof content === 'string' && /<think>/i.test(content)
}

async function chat(body, { label, timeoutMs = 180_000 } = {}) {
  const t0 = performance.now()
  let res
  let text = ''
  let json
  let error
  try {
    res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ model: MODEL, ...body }),
      signal: AbortSignal.timeout(timeoutMs)
    })
    text = await res.text()
    try {
      json = JSON.parse(text)
    } catch {
      /* non-JSON body */
    }
  } catch (e) {
    error = `${e?.name ?? 'Error'}: ${e?.message ?? e}`
  }
  const latencyMs = Math.round(performance.now() - t0)
  const headers = res ? pickHeaders(res.headers) : {}
  const msg = msgOf(json)
  const content =
    typeof msg?.content === 'string' ? msg.content : msg?.content == null ? '' : JSON.stringify(msg.content)
  const reasoning = typeof reasoningOf(msg) === 'string' ? reasoningOf(msg) : JSON.stringify(reasoningOf(msg))
  const rec = {
    label,
    status: res?.status ?? 0,
    latencyMs,
    headers,
    usage: json?.usage,
    finish: json?.choices?.[0]?.finish_reason,
    reasoningChars: reasoning.length,
    contentChars: content.length,
    thinkTags: thinkTagsIn(content),
    toolCalls: msg?.tool_calls?.map((t) => ({ id: t.id, name: t.function?.name, args: t.function?.arguments })),
    messageKeys: msg ? Object.keys(msg) : undefined,
    error: error ?? (res && !res.ok ? redact(text).slice(0, 2000) : undefined),
    requestBody: body,
    responseBody: json ?? redact(text).slice(0, 4000)
  }
  RECORDS.push(rec)
  printRec(rec)
  return { rec, json, msg, content, reasoning }
}

function fmtUsage(u) {
  if (!u) return 'usage=none'
  const det = u.completion_tokens_details ? ` details=${JSON.stringify(u.completion_tokens_details)}` : ''
  const pdet = u.prompt_tokens_details ? ` pdetails=${JSON.stringify(u.prompt_tokens_details)}` : ''
  return `prompt=${u.prompt_tokens} completion=${u.completion_tokens} total=${u.total_tokens}${det}${pdet}`
}

function printRec(rec) {
  const hdr = Object.entries(rec.headers)
    .filter(([k]) => /ratelimit|rate-limit|retry-after|request-id|x-request|cf-ray/i.test(k))
    .map(([k, v]) => `${k}=${v}`)
    .join(' ')
  log(
    `[${rec.label}] HTTP ${rec.status} ${rec.latencyMs} ms ${fmtUsage(rec.usage)} finish=${rec.finish ?? '-'} ` +
      `reasoning_chars=${rec.reasoningChars} content_chars=${rec.contentChars} think_tags=${rec.thinkTags}` +
      (rec.toolCalls ? ` tool_calls=${JSON.stringify(rec.toolCalls.map((t) => t.name))}` : '') +
      (hdr ? ` | ${hdr}` : '')
  )
  if (rec.error) log(`  ERROR: ${rec.error.slice(0, 1200)}`)
}

function preview(s, n = 220) {
  const one = String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  return one.length > n ? `${one.slice(0, n)}…` : one
}

function p50(nums) {
  if (!nums.length) return NaN
  const s = [...nums].sort((a, b) => a - b)
  return s[Math.floor((s.length - 1) / 2)]
}

// Shared prompts
const BASELINE_MESSAGES = [
  {
    role: 'system',
    content: 'You are the assistant inside KeepAnything, a macOS personal library app. Answer concisely.'
  },
  {
    role: 'user',
    content: 'In two sentences, what is a menu-bar utility on macOS and why would a personal library app want one?'
  }
]
const BASELINE_BODY = { messages: BASELINE_MESSAGES, temperature: 0.2, max_tokens: 300 }

const TWO_PARAGRAPHS = `Continuous batching changed how LLM inference servers schedule work. Instead of waiting for every sequence in a batch to finish, the scheduler admits new requests as soon as a slot frees up, which keeps the GPU saturated and cuts p95 latency for short prompts. The trade-off is memory: each in-flight sequence holds its KV-cache, so the scheduler must predict how many tokens a request will still generate or risk pre-empting sequences mid-way.

Paged attention addresses the memory side of that problem. By storing KV-cache in fixed-size blocks that are mapped through a per-sequence page table, the server avoids fragmentation and can share prefix blocks between requests that start with the same system prompt. In our internal benchmark the combination of continuous batching and paged KV-cache raised throughput from 410 to 1,180 tokens per second on a single 80 GB card while keeping time-to-first-token under 350 ms.`

const JSON_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Specific title, 4-12 words' },
    summary: { type: 'string', description: 'Two-sentence summary' },
    topics: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 6 },
    confidence: { type: 'number', minimum: 0, maximum: 1 }
  },
  required: ['title', 'summary', 'topics', 'confidence'],
  additionalProperties: false
}

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_library',
      description:
        "Full-text and semantic search over the user's saved items. Returns up to k matching items with id, title and snippet.",
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural-language or keyword search query' },
          k: { type: 'integer', minimum: 1, maximum: 10, description: 'Maximum number of results (default 5)' }
        },
        required: ['query'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'finish',
      description: 'Finish the task with the final answer for the user and the ids of the items used as sources.',
      parameters: {
        type: 'object',
        properties: {
          result: {
            type: 'object',
            properties: {
              answer: { type: 'string', description: 'Answer for the user, 1-3 sentences' },
              sources: { type: 'array', items: { type: 'string' }, description: 'Item ids that support the answer' }
            },
            required: ['answer', 'sources'],
            additionalProperties: false
          }
        },
        required: ['result'],
        additionalProperties: false
      }
    }
  }
]
const AGENT_SYSTEM =
  "You are the KeepAnything library agent. You can only learn about the user's library through tools. " +
  'Always call search_library before answering. When you have enough information, call finish with the answer and sources. Never answer in plain text.'

const FAKE_RESULTS = {
  batching: [
    {
      id: 'itm_7f3a',
      title: 'Continuous batching and paged KV-cache: internal benchmark',
      snippet: 'Throughput rose from 410 to 1,180 tok/s on one 80 GB card; TTFT under 350 ms.'
    },
    {
      id: 'itm_2c91',
      title: 'vLLM scheduler notes',
      snippet: 'Admission control by predicted output length; pre-emption via recompute vs swap.'
    }
  ],
  quantization: [
    {
      id: 'itm_b0d4',
      title: 'INT8 weight-only quantization results',
      snippet: 'AWQ int4 lost 0.8 points on MMLU; int8 SmoothQuant lossless on our eval set.'
    }
  ]
}
function fakeSearch(args) {
  let q = ''
  try {
    q = String(JSON.parse(args || '{}').query ?? '').toLowerCase()
  } catch {
    q = String(args ?? '').toLowerCase()
  }
  if (/quant/.test(q)) return FAKE_RESULTS.quantization
  return FAKE_RESULTS.batching
}

// Probes
const PROBES = {}

PROBES.baseline = async () => {
  log('\n== baseline: short prompt, temperature 0.2, max_tokens 300 ==')
  const r = await chat(BASELINE_BODY, { label: 'baseline#1' })
  log(`  message keys: ${JSON.stringify(r.rec.messageKeys)}`)
  log(`  reasoning preview: ${preview(r.reasoning, 300)}`)
  log(`  content preview:   ${preview(r.content, 300)}`)
  if (r.rec.usage) {
    const total = r.rec.reasoningChars + r.rec.contentChars
    const share = total ? r.rec.reasoningChars / total : 0
    log(
      `  reasoning share of completion chars: ${(share * 100).toFixed(0)}%  -> est. reasoning tokens ~${Math.round(
        share * r.rec.usage.completion_tokens
      )} of ${r.rec.usage.completion_tokens}`
    )
  }

  log('\n-- thinking-control parameters (does the API accept them, and does reasoning shrink?) --')
  const variants = [
    ['reasoning_effort=low', { reasoning_effort: 'low' }],
    ['reasoning_effort=none', { reasoning_effort: 'none' }],
    ['thinking={type:disabled}', { thinking: { type: 'disabled' } }],
    ['enable_thinking=false', { enable_thinking: false }],
    ['chat_template_kwargs={enable_thinking:false}', { chat_template_kwargs: { enable_thinking: false } }],
    ['reasoning={enabled:false}', { reasoning: { enabled: false } }],
    ['reasoning_split=false', { reasoning_split: false }],
    ['unknown param this_param_does_not_exist=true', { this_param_does_not_exist: true }]
  ]
  for (const [name, extra] of variants) {
    const rr = await chat({ ...BASELINE_BODY, ...extra }, { label: `baseline/${name}` })
    if (rr.rec.status === 200)
      log(`  -> accepted; reasoning_chars=${rr.rec.reasoningChars} content_chars=${rr.rec.contentChars}`)
  }
  const noThink = await chat(
    {
      ...BASELINE_BODY,
      messages: [BASELINE_MESSAGES[0], { role: 'user', content: `/no_think ${BASELINE_MESSAGES[1].content}` }]
    },
    { label: 'baseline//no_think prefix' }
  )
  log(`  -> /no_think: reasoning_chars=${noThink.rec.reasoningChars} content_chars=${noThink.rec.contentChars}`)
}

function classifyJson(content) {
  const trimmed = String(content ?? '').trim()
  const tryParse = (s) => {
    try {
      const v = JSON.parse(s)
      return v && typeof v === 'object' ? v : null
    } catch {
      return null
    }
  }
  const obj = tryParse(trimmed)
  if (obj) return { shape: 'raw', obj }
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)
  if (fence) {
    const fenced = tryParse(fence[1].trim())
    if (fenced) return { shape: 'fenced', obj: fenced }
  }
  const first = trimmed.indexOf('{')
  const last = trimmed.lastIndexOf('}')
  if (first >= 0 && last > first) {
    const embedded = tryParse(trimmed.slice(first, last + 1))
    if (embedded) return { shape: 'prose+json', obj: embedded }
  }
  return { shape: trimmed ? 'no-json' : 'empty', obj: null }
}
function keysOk(obj) {
  return (
    !!obj &&
    typeof obj.title === 'string' &&
    typeof obj.summary === 'string' &&
    Array.isArray(obj.topics) &&
    typeof obj.confidence === 'number' &&
    Object.keys(obj).every((k) => ['title', 'summary', 'topics', 'confidence'].includes(k))
  )
}

PROBES.json = async () => {
  log('\n== json: understanding-style summary, three ways, 3 samples each ==')
  const system =
    'You extract structured understanding from text for a personal library. Respond with a single JSON object with exactly the keys ' +
    '"title" (string), "summary" (string, two sentences), "topics" (array of 2-6 short strings), "confidence" (number 0-1). ' +
    'Output only the JSON object: no markdown fences, no commentary.'
  const user = `Summarize this text into the JSON object.\n\n${TWO_PARAGRAPHS}`
  const modes = [
    ['prompt-only', {}],
    ['json_object', { response_format: { type: 'json_object' } }],
    [
      'json_schema',
      {
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'understanding', strict: true, schema: JSON_SCHEMA }
        }
      }
    ]
  ]
  const tally = {}
  for (const [mode, extra] of modes) {
    tally[mode] = { raw: 0, fenced: 0, 'prose+json': 0, 'no-json': 0, empty: 0, keysOk: 0, http: [] }
    for (let i = 1; i <= 3; i++) {
      const r = await chat(
        {
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ],
          temperature: 0.2,
          max_tokens: 1200,
          ...extra
        },
        { label: `json/${mode}#${i}` }
      )
      tally[mode].http.push(r.rec.status)
      if (r.rec.status !== 200) continue
      const c = classifyJson(r.content)
      tally[mode][c.shape]++
      if (keysOk(c.obj)) tally[mode].keysOk++
      log(`  -> shape=${c.shape} keysOk=${keysOk(c.obj)} content: ${preview(r.content, 160)}`)
    }
  }
  log('\n  json adherence tally (3 samples per mode):')
  for (const [mode, t] of Object.entries(tally))
    log(
      `  ${mode.padEnd(12)} raw=${t.raw} fenced=${t.fenced} prose+json=${t['prose+json']} no-json=${t['no-json']} empty=${t.empty} keysOk=${t.keysOk} http=${t.http.join(',')}`
    )
}

PROBES.sampling = async () => {
  log('\n== sampling: understand-style JSON at three sampling settings, 4 samples each ==')
  const system =
    'You extract structured understanding from text for a personal library. Respond with a single JSON object with exactly the keys ' +
    '"title" (string), "summary" (string, two sentences), "topics" (array of 2-6 short strings), "confidence" (number 0-1). ' +
    'Output only the JSON object: no markdown fences, no commentary.'
  const user = `Summarize this text into the JSON object.\n\n${TWO_PARAGRAPHS}`
  const settings = [
    ['vendor-default (no temp/top_p)', {}],
    ['temp=1.0 top_p=0.95', { temperature: 1.0, top_p: 0.95 }],
    ['temp=0.2', { temperature: 0.2 }]
  ]
  const rows = []
  for (const [name, extra] of settings) {
    let parsed = 0,
      ok = 0
    const lat = [],
      comp = [],
      titles = []
    for (let i = 1; i <= 4; i++) {
      const r = await chat(
        {
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ],
          max_tokens: 1200,
          ...extra
        },
        { label: `sampling/${name}#${i}` }
      )
      if (r.rec.status !== 200) continue
      lat.push(r.rec.latencyMs)
      comp.push(r.rec.usage?.completion_tokens ?? NaN)
      const c = classifyJson(r.content)
      if (c.obj) parsed++
      if (keysOk(c.obj)) ok++
      titles.push(c.obj?.title ?? '(none)')
    }
    rows.push({ name, parsed, ok, p50Latency: p50(lat), p50Completion: p50(comp), titles })
  }
  log('\n  sampling tally (4 samples each):')
  for (const r of rows)
    log(
      `  ${r.name.padEnd(32)} parsed=${r.parsed}/4 keysOk=${r.ok}/4 p50_ms=${r.p50Latency} p50_completion=${r.p50Completion} titles=${JSON.stringify(r.titles)}`
    )
}

PROBES.tools = async () => {
  log('\n== tools: search_library + finish, single and parallel, reasoning_content round-trip ==')
  const messages = [
    { role: 'system', content: AGENT_SYSTEM },
    { role: 'user', content: 'What did I save about inference batching strategies last month?' }
  ]
  const step1 = await chat(
    { messages, tools: TOOLS, tool_choice: 'auto', temperature: 0.2, max_tokens: 1500 },
    { label: 'tools/step1' }
  )
  const m1 = step1.msg
  if (!m1?.tool_calls?.length) {
    log(`  !! no tool_calls in step 1. content: ${preview(step1.content, 300)}`)
    log('  retrying step 1 with tool_choice=required')
    const forced = await chat(
      { messages, tools: TOOLS, tool_choice: 'required', temperature: 0.2, max_tokens: 1500 },
      { label: 'tools/step1 tool_choice=required' }
    )
    if (!forced.msg?.tool_calls?.length) return
    Object.assign(step1, forced)
  } else {
    // Also check tool_choice=required acceptance on the same prompt.
    await chat(
      { messages, tools: TOOLS, tool_choice: 'required', temperature: 0.2, max_tokens: 1500 },
      { label: 'tools/step1 tool_choice=required' }
    )
  }
  const assistant = step1.msg
  log(`  step1 tool_calls: ${JSON.stringify(step1.rec.toolCalls)}`)
  log(
    `  step1 reasoning_content present=${!!assistant.reasoning_content} chars=${step1.rec.reasoningChars}; content=${JSON.stringify(preview(assistant.content, 120))}`
  )

  const toolMsgs = assistant.tool_calls.map((tc) => ({
    role: 'tool',
    tool_call_id: tc.id,
    content: JSON.stringify(fakeSearch(tc.function?.arguments))
  }))
  const variants = [
    [
      'reasoning_content verbatim',
      {
        role: 'assistant',
        content: assistant.content ?? '',
        tool_calls: assistant.tool_calls,
        reasoning_content: assistant.reasoning_content ?? ''
      }
    ],
    [
      'reasoning_content omitted',
      { role: 'assistant', content: assistant.content ?? '', tool_calls: assistant.tool_calls }
    ],
    [
      'reasoning_content null',
      { role: 'assistant', content: assistant.content ?? '', tool_calls: assistant.tool_calls, reasoning_content: null }
    ]
  ]
  for (const [name, asst] of variants) {
    const r = await chat(
      {
        messages: [...messages, asst, ...toolMsgs],
        tools: TOOLS,
        tool_choice: 'auto',
        temperature: 0.2,
        max_tokens: 1500
      },
      { label: `tools/step2 ${name}` }
    )
    if (r.rec.status !== 200) continue
    const fin = r.msg?.tool_calls?.find((t) => t.function?.name === 'finish')
    log(
      `  -> finish called=${!!fin} other_tool_calls=${JSON.stringify((r.msg?.tool_calls ?? []).map((t) => t.function?.name))} content=${JSON.stringify(preview(r.content, 160))}`
    )
    if (fin) log(`     finish args: ${preview(fin.function.arguments, 300)}`)
  }
  // Forced finish (the orchestrator's "last allowed step").
  const forcedFinish = await chat(
    {
      messages: [...messages, variants[1][1], ...toolMsgs],
      tools: TOOLS,
      tool_choice: { type: 'function', function: { name: 'finish' } },
      temperature: 0.2,
      max_tokens: 1500
    },
    { label: 'tools/step2 tool_choice=finish' }
  )
  if (forcedFinish.rec.status === 200)
    log(`  -> forced finish: tool_calls=${JSON.stringify(forcedFinish.rec.toolCalls?.map((t) => t.name))}`)

  log('\n-- parallel tool calls --')
  const pmessages = [
    { role: 'system', content: AGENT_SYSTEM },
    {
      role: 'user',
      content:
        'Compare what I saved about inference batching with what I saved about model quantization. Search for both before answering.'
    }
  ]
  const par = await chat(
    { messages: pmessages, tools: TOOLS, tool_choice: 'auto', temperature: 0.2, max_tokens: 1500 },
    { label: 'tools/parallel' }
  )
  log(`  -> ${par.msg?.tool_calls?.length ?? 0} tool_calls in one message: ${JSON.stringify(par.rec.toolCalls)}`)
  const par2 = await chat(
    {
      messages: pmessages,
      tools: TOOLS,
      tool_choice: 'auto',
      parallel_tool_calls: true,
      temperature: 0.2,
      max_tokens: 1500
    },
    { label: 'tools/parallel parallel_tool_calls=true' }
  )
  log(`  -> ${par2.msg?.tool_calls?.length ?? 0} tool_calls with parallel_tool_calls=true`)
  if (par.msg?.tool_calls?.length) {
    const toolMsgs2 = par.msg.tool_calls.map((tc) => ({
      role: 'tool',
      tool_call_id: tc.id,
      content: JSON.stringify(fakeSearch(tc.function?.arguments))
    }))
    const asst2 = {
      role: 'assistant',
      content: par.msg.content ?? '',
      tool_calls: par.msg.tool_calls,
      reasoning_content: par.msg.reasoning_content ?? ''
    }
    const r = await chat(
      {
        messages: [...pmessages, asst2, ...toolMsgs2],
        tools: TOOLS,
        tool_choice: 'auto',
        temperature: 0.2,
        max_tokens: 1500
      },
      { label: 'tools/parallel step2' }
    )
    log(
      `  -> step2 tool_calls=${JSON.stringify(r.rec.toolCalls?.map((t) => t.name))} content=${JSON.stringify(preview(r.content, 160))}`
    )
  }
}

async function ensureResized(px) {
  const src = path.join(ROOT, 'build', 'icon.png')
  const dst = `/tmp/keepanything-icon-${px}.png`
  try {
    await access(dst)
  } catch {
    await execFileP('cp', [src, dst])
    await execFileP('sips', ['-Z', String(px), dst])
  }
  return dst
}

PROBES.vision = async () => {
  log('\n== vision: image_url data URLs ==')
  const files = [path.join(ROOT, 'build', 'icon.png')]
  for (const px of [1200, 4000]) {
    try {
      files.push(await ensureResized(px))
    } catch (e) {
      log(`  could not create ${px}px image: ${e.message}`)
    }
  }
  const ask = async (url, label, detail) => {
    const r = await chat(
      {
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'What does this image depict? Describe it in two sentences, then list any visible text.'
              },
              { type: 'image_url', image_url: detail ? { url, detail } : { url } }
            ]
          }
        ],
        temperature: 0.2,
        max_tokens: 400
      },
      { label }
    )
    if (r.rec.status === 200) log(`  -> ${preview(r.content, 260)}`)
    return r
  }
  for (const f of files) {
    const buf = await readFile(f)
    const dataUrl = `data:image/png;base64,${buf.toString('base64')}`
    await ask(dataUrl, `vision/${path.basename(f)} (${(buf.length / 1024).toFixed(0)} KB)`)
  }
  // A generated "screenshot" fixture (terminal-like PNG with legible text), if present.
  const shot = path.join(ROOT, 'tests', 'fixtures', 'demo', 'files', 'screenshots', 'terminal-pnpm-test.png')
  try {
    const buf = await readFile(shot)
    await ask(
      `data:image/png;base64,${buf.toString('base64')}`,
      `vision/screenshot-fixture (${(buf.length / 1024).toFixed(0)} KB)`
    )
    await ask(`data:image/png;base64,${buf.toString('base64')}`, 'vision/screenshot-fixture detail=low', 'low')
  } catch {
    log('  (no screenshot fixture yet; skipping)')
  }
  // Remote https image (does the API fetch URLs server-side?).
  await ask(
    'https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png',
    'vision/https-png'
  )
  await ask('https://raw.githubusercontent.com/electron/electron/main/default_app/icon.png', 'vision/https-github-raw')
}

function longText(targetChars) {
  const topics = [
    'continuous batching',
    'paged KV-cache',
    'speculative decoding',
    'int8 weight quantization',
    'tensor parallelism',
    'prefix caching',
    'request admission control',
    'GPU memory fragmentation'
  ]
  const templates = [
    (t, i) =>
      `Week ${i} of the serving project concentrated on ${t}, because the previous load test showed p95 latency climbing above the 800 ms budget whenever more than forty concurrent sessions were active.`,
    (t, i) =>
      `The team measured ${t} on the staging cluster with the same 2,000-request replay set used since week ${Math.max(1, i - 3)}, so the numbers are directly comparable with earlier reports.`,
    (t) =>
      `The main risk with ${t} is operational rather than algorithmic: it adds a configuration surface that on-call engineers must understand at three in the morning.`,
    (t, i) =>
      `Decision ${i}: adopt ${t} behind a feature flag, roll it out to ten percent of traffic, and revert automatically if the error rate rises by more than half a percent.`,
    (t) =>
      `A short follow-up experiment showed that ${t} interacts with the tokenizer cache in a way nobody predicted, which cost two days of debugging and one very long incident review.`,
    (t) =>
      `Documentation for ${t} now lives in the runbook, together with the dashboards that show queue depth, tokens per second, and time to first token per model.`
  ]
  const paras = []
  let total = 0
  let i = 1
  while (total < targetChars) {
    const t = topics[i % topics.length]
    const sentences = templates.map((fn) => fn(t, i))
    const p = sentences.join(' ')
    paras.push(p)
    total += p.length + 2
    i++
  }
  return paras.join('\n\n')
}

PROBES.long = async () => {
  log('\n== long: 12k chars (understand-size) and ~80k chars (~20k tokens) with a needle ==')
  for (const [label, chars] of [
    ['long/12k-chars', 12_000],
    ['long/80k-chars', 80_000]
  ]) {
    let text = longText(chars)
    // Plant a needle two thirds in.
    const paras = text.split('\n\n')
    const at = Math.floor(paras.length * 0.66)
    paras.splice(
      at,
      0,
      'Side note: the staging cluster password rotation is owned by Priyanka, and the KV-cache block size was finally fixed at 24 tokens after the week-9 incident.'
    )
    text = paras.join('\n\n')
    log(`  generated ${text.length} chars in ${paras.length} paragraphs`)
    const r = await chat(
      {
        messages: [
          { role: 'system', content: 'You summarize engineering notes for a personal library. Be specific.' },
          {
            role: 'user',
            content: `Summarize the following notes in about 200 words, list the five most important decisions as bullet points, and answer: what KV-cache block size was fixed, and who owns password rotation?\n\n${text}`
          }
        ],
        temperature: 0.2,
        max_tokens: 2000
      },
      { label }
    )
    if (r.rec.usage) log(`  chars per prompt token: ${(text.length / r.rec.usage.prompt_tokens).toFixed(2)}`)
    const found24 = /\b24\b/.test(r.content)
    const foundName = /priyanka/i.test(r.content)
    log(`  needle recall: block size 24=${found24} owner=${foundName}`)
    log(`  content preview: ${preview(r.content, 300)}`)
  }
}

PROBES.concurrency = async () => {
  log('\n== concurrency: 3 then 4 identical baseline requests in parallel ==')
  for (const n of [3, 4]) {
    const t0 = performance.now()
    const results = await Promise.all(
      Array.from({ length: n }, (_, i) => chat(BASELINE_BODY, { label: `concurrency/${n}x#${i + 1}` }))
    )
    const wall = Math.round(performance.now() - t0)
    const statuses = results.map((r) => r.rec.status)
    const lat = results.map((r) => r.rec.latencyMs)
    const rl = results.flatMap((r) =>
      Object.entries(r.rec.headers).filter(([k]) => /ratelimit|rate-limit|retry-after/i.test(k))
    )
    log(
      `  ${n}x: statuses=${statuses.join(',')} wall=${wall} ms latency min/p50/max=${Math.min(...lat)}/${p50(lat)}/${Math.max(...lat)} 429s=${statuses.filter((s) => s === 429).length}`
    )
    log(`  ${n}x: rate-limit-ish headers seen: ${rl.length ? JSON.stringify(rl) : 'none'}`)
  }
}

PROBES.streaming = async () => {
  log('\n== streaming: stream=true (+stream_options.include_usage) ==')
  const run = async (extra, label) => {
    const t0 = performance.now()
    const rec = {
      label,
      status: 0,
      latencyMs: 0,
      headers: {},
      requestBody: { ...BASELINE_BODY, stream: true, ...extra }
    }
    let res
    try {
      res = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ model: MODEL, ...rec.requestBody }),
        signal: AbortSignal.timeout(180_000)
      })
    } catch (e) {
      rec.error = `${e?.name}: ${e?.message}`
      RECORDS.push(rec)
      printRec(rec)
      return rec
    }
    rec.status = res.status
    rec.headers = pickHeaders(res.headers)
    if (!res.ok) {
      rec.error = redact(await res.text()).slice(0, 2000)
      rec.latencyMs = Math.round(performance.now() - t0)
      RECORDS.push(rec)
      printRec(rec)
      return rec
    }
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    let tFirstByte, tFirstReasoning, tFirstContent
    let nEvents = 0,
      nReasoning = 0,
      nContent = 0,
      reasoningChars = 0,
      contentChars = 0
    const deltaKeys = new Set()
    let usage,
      finish,
      sawDone = false,
      thinkTags = false
    let firstEvent
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      tFirstByte ??= performance.now()
      buf += dec.decode(value, { stream: true })
      for (;;) {
        const idx = buf.indexOf('\n')
        if (idx < 0) break
        const line = buf.slice(0, idx).trim()
        buf = buf.slice(idx + 1)
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') {
          sawDone = true
          continue
        }
        let ev
        try {
          ev = JSON.parse(data)
        } catch {
          continue
        }
        nEvents++
        firstEvent ??= ev
        if (ev.usage) usage = ev.usage
        const ch = ev.choices?.[0]
        if (!ch) continue
        if (ch.finish_reason) finish = ch.finish_reason
        const d = ch.delta ?? {}
        for (const k of Object.keys(d)) if (d[k] != null && d[k] !== '') deltaKeys.add(k)
        const r = d.reasoning_content ?? d.reasoning
        if (typeof r === 'string' && r) {
          nReasoning++
          reasoningChars += r.length
          tFirstReasoning ??= performance.now()
        }
        if (typeof d.content === 'string' && d.content) {
          nContent++
          contentChars += d.content.length
          if (/<think>/i.test(d.content)) thinkTags = true
          tFirstContent ??= performance.now()
        }
      }
    }
    const tEnd = performance.now()
    Object.assign(rec, {
      latencyMs: Math.round(tEnd - t0),
      usage,
      finish,
      reasoningChars,
      contentChars,
      thinkTags,
      stream: {
        ttfbMs: tFirstByte ? Math.round(tFirstByte - t0) : null,
        ttfReasoningMs: tFirstReasoning ? Math.round(tFirstReasoning - t0) : null,
        ttfContentMs: tFirstContent ? Math.round(tFirstContent - t0) : null,
        events: nEvents,
        reasoningDeltas: nReasoning,
        contentDeltas: nContent,
        deltaKeys: [...deltaKeys],
        sawDone,
        usageInStream: !!usage,
        firstEventKeys: firstEvent ? Object.keys(firstEvent) : []
      }
    })
    RECORDS.push(rec)
    printRec(rec)
    log(`  stream: ${JSON.stringify(rec.stream)}`)
    return rec
  }
  const a = await run({ stream_options: { include_usage: true } }, 'streaming/include_usage')
  if (a.status !== 200) await run({}, 'streaming/plain')
  else await run({}, 'streaming/plain')
}

PROBES.params = async () => {
  log('\n== params: sampling parameters, max_tokens behaviour ==')
  const cases = [
    [
      'combined temp+top_p+max_tokens+stop[]+seed',
      { temperature: 0.2, top_p: 0.9, max_tokens: 300, stop: ['###'], seed: 42 }
    ],
    ['stop as string', { stop: '###' }],
    ['seed=7 temperature=0 (run A)', { seed: 7, temperature: 0 }],
    ['seed=7 temperature=0 (run B)', { seed: 7, temperature: 0 }],
    ['max_tokens=64', { max_tokens: 64 }],
    ['max_tokens=1 (docs say range 1-128)', { max_tokens: 1 }],
    ['max_tokens=200000 (above any sane cap)', { max_tokens: 200_000 }],
    ['max_completion_tokens=300 (no max_tokens)', { max_tokens: undefined, max_completion_tokens: 300 }],
    ['top_k=40 (documented)', { top_k: 40 }],
    ['n=2', { n: 2 }],
    ['frequency_penalty=0.2 presence_penalty=0.2', { frequency_penalty: 0.2, presence_penalty: 0.2 }],
    ['context_length_exceeded_behavior=error (documented)', { context_length_exceeded_behavior: 'error' }],
    ['temperature=3 (out of documented range 0-2)', { temperature: 3 }]
  ]
  const seedOutputs = []
  for (const [name, extra] of cases) {
    const body = { ...BASELINE_BODY, ...extra }
    for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k]
    const r = await chat(body, { label: `params/${name}` })
    if (name.startsWith('seed=7')) seedOutputs.push(r.content)
    if (name.startsWith('max_tokens=64') || name.startsWith('max_tokens=1 ')) {
      log(
        `  -> finish=${r.rec.finish} reasoning_chars=${r.rec.reasoningChars} content_chars=${r.rec.contentChars} content=${JSON.stringify(preview(r.content, 160))}`
      )
    }
    if (name.startsWith('n=2')) log(`  -> choices returned: ${r.json?.choices?.length ?? 0}`)
  }
  if (seedOutputs.length === 2)
    log(`  seed determinism (same seed, temperature 0): identical content=${seedOutputs[0] === seedOutputs[1]}`)
}

PROBES.followups = async () => {
  log('\n== followups: schema enforcement without prompt help, forcing finish, null content, JPEG, hard reasoning ==')
  // 1. Is response_format enforced when the prompt does NOT mention JSON at all?
  for (const [mode, extra] of [
    [
      'json_schema',
      {
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'understanding', strict: true, schema: JSON_SCHEMA }
        }
      }
    ],
    ['json_object', { response_format: { type: 'json_object' } }]
  ]) {
    const r = await chat(
      {
        messages: [{ role: 'user', content: `Summarize this text in two sentences.\n\n${TWO_PARAGRAPHS}` }],
        temperature: 0.2,
        max_tokens: 800,
        ...extra
      },
      { label: `followups/${mode} without JSON in prompt` }
    )
    if (r.rec.status === 200) {
      const c = classifyJson(r.content)
      log(`  -> shape=${c.shape} keysOk=${keysOk(c.obj)} content: ${preview(r.content, 200)}`)
    }
  }
  // 2. Forcing finish: named tool_choice was ignored earlier; try tools=[finish] + tool_choice=required.
  const messages = [
    { role: 'system', content: AGENT_SYSTEM },
    { role: 'user', content: 'What did I save about inference batching strategies last month?' }
  ]
  const step1 = await chat(
    { messages, tools: TOOLS, tool_choice: 'required', temperature: 0.2, max_tokens: 1500 },
    { label: 'followups/step1' }
  )
  if (step1.msg?.tool_calls?.length) {
    const toolMsgs = step1.msg.tool_calls.map((tc) => ({
      role: 'tool',
      tool_call_id: tc.id,
      content: JSON.stringify(fakeSearch(tc.function?.arguments))
    }))
    const asstNull = { role: 'assistant', content: null, tool_calls: step1.msg.tool_calls }
    const finishOnly = TOOLS.filter((t) => t.function.name === 'finish')
    const r1 = await chat(
      {
        messages: [...messages, asstNull, ...toolMsgs],
        tools: finishOnly,
        tool_choice: 'required',
        temperature: 0.2,
        max_tokens: 1500
      },
      { label: 'followups/force finish via tools=[finish]+required, assistant content=null' }
    )
    if (r1.rec.status === 200)
      log(
        `  -> tool_calls=${JSON.stringify(r1.rec.toolCalls?.map((t) => t.name))} content=${JSON.stringify(preview(r1.content, 120))}`
      )
    const r2 = await chat(
      {
        messages: [
          ...messages,
          asstNull,
          ...toolMsgs,
          { role: 'user', content: 'You have enough information. Call finish now.' }
        ],
        tools: TOOLS,
        tool_choice: 'auto',
        temperature: 0.2,
        max_tokens: 1500
      },
      { label: 'followups/nudge user message "call finish now"' }
    )
    if (r2.rec.status === 200) log(`  -> tool_calls=${JSON.stringify(r2.rec.toolCalls?.map((t) => t.name))}`)
    const r3 = await chat(
      {
        messages: [...messages, asstNull, ...toolMsgs],
        tools: TOOLS,
        tool_choice: 'none',
        temperature: 0.2,
        max_tokens: 800
      },
      { label: 'followups/tool_choice=none after tool results' }
    )
    if (r3.rec.status === 200)
      log(
        `  -> tool_calls=${JSON.stringify(r3.rec.toolCalls?.map((t) => t.name) ?? null)} content=${JSON.stringify(preview(r3.content, 160))}`
      )
  }
  // 3. JPEG data URI (URL snapshots are JPEG) at snapshot size.
  try {
    const src = path.join(ROOT, 'tests', 'fixtures', 'demo', 'files', 'screenshots', 'pricing-page-inference.png')
    const jpg = '/tmp/keepanything-pricing-1280.jpg'
    await execFileP('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '82', '-Z', '1280', src, '--out', jpg])
    const buf = await readFile(jpg)
    const r = await chat(
      {
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'This is a screenshot of a web page. In JSON with keys "visualDescription" and "visibleText", describe it and transcribe the prices you can read.'
              },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${buf.toString('base64')}` } }
            ]
          }
        ],
        temperature: 0.2,
        max_tokens: 600
      },
      { label: `followups/vision jpeg 1280px (${(buf.length / 1024).toFixed(0)} KB)` }
    )
    if (r.rec.status === 200) log(`  -> ${preview(r.content, 400)}`)
  } catch (e) {
    log(`  jpeg probe failed: ${e.message}`)
  }
  // 4. Hard reasoning prompt: does any thinking surface (think tags / reasoning field / hidden tokens)?
  const hard = await chat(
    {
      messages: [
        {
          role: 'user',
          content:
            'Three items were saved on different days. The PDF was saved before the repo. The screenshot was not saved last. The repo was not saved first. Which was saved first, second, third? Answer with just the order.'
        }
      ],
      temperature: 0.2,
      max_tokens: 2000
    },
    { label: 'followups/hard reasoning' }
  )
  if (hard.rec.status === 200) {
    const u = hard.rec.usage
    log(
      `  -> completion_tokens=${u?.completion_tokens} content_chars=${hard.rec.contentChars} chars/token=${(hard.rec.contentChars / (u?.completion_tokens || 1)).toFixed(2)} keys=${JSON.stringify(hard.rec.messageKeys)} content=${JSON.stringify(preview(hard.content, 200))}`
    )
  }
}

// Main
const ORDER = [
  'baseline',
  'json',
  'sampling',
  'tools',
  'vision',
  'long',
  'concurrency',
  'streaming',
  'params',
  'followups'
]
const wanted = process.argv.slice(2).filter(Boolean)
const selected = wanted.length === 0 || wanted.includes('all') ? ORDER : wanted
for (const name of selected) {
  if (!PROBES[name]) {
    console.error(`unknown probe "${name}". Known: ${ORDER.join(', ')}`)
    process.exit(2)
  }
}
log(`GMI probe -> ${BASE_URL} model=${MODEL} probes=${selected.join(',')} node=${process.version}`)
log(`results dir: ${OUT_DIR}`)

const tStart = performance.now()
for (const name of selected) {
  try {
    await PROBES[name]()
  } catch (e) {
    log(`!! probe ${name} threw: ${e?.stack ?? e}`)
  }
}

// Summary
log('\n== summary (per probe group) ==')
const groups = new Map()
for (const r of RECORDS) {
  const g = r.label.split(/[/#]/)[0]
  if (!groups.has(g)) groups.set(g, [])
  groups.get(g).push(r)
}
log('group        n   ok  p50_ms  max_ms  p50_prompt  p50_completion  p50_reasoning_chars  p50_content_chars')
for (const [g, recs] of groups) {
  const ok = recs.filter((r) => r.status === 200)
  const f = (arr) => (arr.length ? String(Math.round(p50(arr))) : '-')
  log(
    `${g.padEnd(12)} ${String(recs.length).padStart(2)}  ${String(ok.length).padStart(3)}  ${f(ok.map((r) => r.latencyMs)).padStart(6)}  ${f(ok.map((r) => r.latencyMs)).length ? String(Math.max(0, ...ok.map((r) => r.latencyMs))).padStart(6) : '     -'}  ` +
      `${f(ok.map((r) => r.usage?.prompt_tokens).filter(Number.isFinite)).padStart(10)}  ${f(ok.map((r) => r.usage?.completion_tokens).filter(Number.isFinite)).padStart(14)}  ` +
      `${f(ok.map((r) => r.reasoningChars).filter(Number.isFinite)).padStart(19)}  ${f(ok.map((r) => r.contentChars).filter(Number.isFinite)).padStart(17)}`
  )
}
log(
  `total wall time ${Math.round((performance.now() - tStart) / 1000)} s, ${RECORDS.length} requests, statuses=${JSON.stringify(Object.fromEntries([...new Set(RECORDS.map((r) => r.status))].map((s) => [s, RECORDS.filter((r) => r.status === s).length])))}`
)

const outFile = path.join(OUT_DIR, `${selected.join('_')}.json`)
await writeFile(outFile, redact(JSON.stringify(RECORDS, null, 2)))
log(`wrote ${outFile}`)
