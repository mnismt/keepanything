import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { LIMITS } from '../../shared/constants'
import { capText, EXTRACTION_BUDGET, type ExtractedContent, type Extractor, squash } from './types'

/**
 * Plain text, Markdown and source code. Markdown gets its headings and front matter into
 * metadata; code gets a language guess from the extension.
 */

/** Extension -> language label used in `metadata.language`. */
export const LANGUAGE_BY_EXT: Readonly<Record<string, string>> = {
  js: 'JavaScript',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  jsx: 'JavaScript',
  ts: 'TypeScript',
  tsx: 'TypeScript',
  mts: 'TypeScript',
  py: 'Python',
  go: 'Go',
  rs: 'Rust',
  java: 'Java',
  kt: 'Kotlin',
  swift: 'Swift',
  m: 'Objective-C',
  c: 'C',
  h: 'C',
  cpp: 'C++',
  cc: 'C++',
  hpp: 'C++',
  cs: 'C#',
  rb: 'Ruby',
  php: 'PHP',
  sh: 'Shell',
  bash: 'Shell',
  zsh: 'Shell',
  fish: 'Shell',
  ps1: 'PowerShell',
  sql: 'SQL',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  json: 'JSON',
  jsonl: 'JSON Lines',
  yaml: 'YAML',
  yml: 'YAML',
  toml: 'TOML',
  xml: 'XML',
  ini: 'INI',
  env: 'dotenv',
  dockerfile: 'Dockerfile',
  makefile: 'Makefile',
  lua: 'Lua',
  r: 'R',
  scala: 'Scala',
  dart: 'Dart',
  ex: 'Elixir',
  exs: 'Elixir',
  hs: 'Haskell',
  zig: 'Zig',
  vue: 'Vue',
  svelte: 'Svelte',
  graphql: 'GraphQL',
  proto: 'Protocol Buffers',
  tf: 'Terraform',
  nix: 'Nix'
}

export function guessLanguage(fileName: string): string | null {
  const lower = fileName.toLowerCase()
  const base = lower.split('/').pop() ?? lower
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) return 'Dockerfile'
  if (base === 'makefile') return 'Makefile'
  const ext = extname(base).slice(1)
  return LANGUAGE_BY_EXT[ext] ?? null
}

/** True when the bytes look like text (no NUL, mostly printable) rather than a binary blob. */
export function looksTextual(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 8192))
  if (sample.length === 0) return true
  let control = 0
  for (const b of sample) {
    if (b === 0) return false
    if (b < 7 || (b > 13 && b < 32)) control += 1
  }
  return control / sample.length < 0.02
}

/** Parsed Markdown front matter (simple `key: value` lines only). */
export function parseFrontMatter(text: string): { data: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (!match) return { data: {}, body: text }
  const data: Record<string, string> = {}
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (kv?.[1]) data[kv[1]] = (kv[2] ?? '').trim().replace(/^["']|["']$/g, '')
  }
  return { data, body: text.slice(match[0].length) }
}

/** ATX headings of a Markdown document, in order (≤ `max`). */
export function markdownHeadings(markdown: string, max = 40): string[] {
  const out: string[] = []
  let inFence = false
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    if (inFence) continue
    const m = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)
    if (m?.[1]) {
      out.push(m[1].replace(/[*_`]/g, '').trim())
      if (out.length >= max) break
    }
  }
  return out
}

/** Strip Markdown syntax to approximate plain text for FTS/excerpts. */
export function markdownToText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[^\n]*\n?/g, ''))
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^ {0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/^[ \t]*[-*+][ \t]+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Title from the first heading, front matter, or first non-empty line. */
export function deriveTitle(text: string, fallback?: string): string | undefined {
  const { data, body } = parseFrontMatter(text)
  if (data.title) return squash(data.title, 120)
  const heading = markdownHeadings(body, 1)[0]
  if (heading) return squash(heading, 120)
  const firstLine = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  if (!firstLine) return fallback
  if (firstLine.length <= 120) return firstLine
  const sentence = /^(.{20,160}?[.!?])(\s|$)/.exec(firstLine)?.[1]
  return squash(sentence ?? firstLine, 80)
}

/** Extract from an in-memory string; shared by the file adapter, notes and captured text. */
export function extractTextContent(
  raw: string,
  opts: { fileName?: string; kind: 'text' | 'markdown' | 'code' }
): ExtractedContent {
  const normalized = raw.replace(/\r\n?/g, '\n').replace(/^﻿/, '')
  const meta: Record<string, unknown> = {}
  let body = normalized
  let markdown: string | undefined
  if (opts.kind === 'markdown') {
    const fm = parseFrontMatter(normalized)
    body = fm.body
    if (Object.keys(fm.data).length > 0) meta.frontMatter = fm.data
    const headings = markdownHeadings(body)
    if (headings.length > 0) meta.headings = headings
    markdown = body
  } else if (opts.kind === 'code') {
    const language = opts.fileName ? guessLanguage(opts.fileName) : null
    if (language) meta.language = language
    meta.lines = body.split('\n').length
  }
  const plain = opts.kind === 'markdown' ? markdownToText(body) : body
  const capped = capText(plain, EXTRACTION_BUDGET.maxChars)
  meta.wordCount = plain.split(/\s+/).filter(Boolean).length
  const title = opts.kind === 'code' ? undefined : deriveTitle(normalized)
  const out: ExtractedContent = { text: capped.text, meta, truncated: capped.truncated }
  if (markdown !== undefined) out.markdown = markdown.slice(0, EXTRACTION_BUDGET.contentFileChars)
  if (title) out.title = title
  const excerpt = squash(plain, LIMITS.excerptChars)
  if (excerpt) meta.excerpt = excerpt
  return out
}

export const textExtractor: Extractor = {
  id: 'text',
  async extract({ item, filePath }) {
    if (!filePath) throw new Error('No file to read')
    const stats = await stat(filePath)
    const truncatedFile = stats.size > EXTRACTION_BUDGET.maxTextFileBytes
    const raw = truncatedFile
      ? (await readFile(filePath)).subarray(0, EXTRACTION_BUDGET.maxTextFileBytes).toString('utf8')
      : await readFile(filePath, 'utf8')
    const name = item.metadata.originalName ?? filePath
    const kind =
      item.type === 'markdown' ? 'markdown' : item.type === 'text' || /\.(txt|text|log)$/i.test(name) ? 'text' : 'code'
    const result = extractTextContent(raw, { fileName: name, kind })
    if (truncatedFile) result.truncated = true
    return result
  }
}
