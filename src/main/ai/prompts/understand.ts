/** Text is capped by the caller at `LIMITS.understandTextChars`; images arrive as `data:` URIs (≤ 800 px thumbnails, snapshots) and trigger the vision instructions. */
import { LIMITS } from '../../../shared/constants'
import type { ItemSubtype, ItemType } from '../../../shared/types'
import type { ChatMessage, ChatRequest, ContentPart } from '../../ports'
import { imagePart, systemMessage, textPart, userMessage } from '../messages'
import { ACTION_CATALOG, clipText, IDENTITY, jsonBlock, KIND_RULES, VOICE_RULES } from './voice'

export interface UnderstandInput {
  title: string
  type: ItemType
  subtype?: ItemSubtype | null
  url?: string | null
  domain?: string | null
  mimeType?: string | null
  /** Compact facts worth showing (og, repo, exif dims, page count...). Keep it small. */
  metadata?: Record<string, unknown>
  /** Extracted text, capped by the caller. */
  text?: string | null
  /** `data:` URIs of the thumbnail / snapshot / og image. */
  images?: string[]
  /** For folders and notes with sources: one-liners of related children. */
  children?: { title: string; kind?: string | null; understanding?: string | null }[]
  /** ISO date the item was captured (goes in the user message, never the system prompt). */
  capturedAt?: string
}

/** Byte-stable system prompt. */
export const UNDERSTAND_SYSTEM_PROMPT = [
  IDENTITY,
  '',
  'Task: understand one kept item. Answer: what is this, what does it contain, why would someone keep it, and how would they look for it later.',
  '',
  VOICE_RULES,
  '',
  KIND_RULES,
  '',
  'Fields:',
  '- title: a clean, specific title (product name, article headline, what the screenshot shows). No site suffixes like " | Medium".',
  '- summary: one or two sentences: what this is and what it contains. Specific nouns, no filler.',
  '- whyUseful: one sentence on why a person would keep this and when they would reach for it.',
  '- topics: up to 6 short lowercase topics (2–3 words each) a person would use as memory cues.',
  '- entities: named products, people, companies, repos, places that appear in the material.',
  '- visualDescription, visibleText: only when an image is attached (see below); otherwise omit them.',
  '- retrievalHints: 3–6 phrases someone might type months later ("that mac app for window tiling", "vllm batching article"). Include synonyms and the plain-language version of jargon.',
  `- suggestedActions: 0–4 ids from this catalogue that make sense for this item:\n${ACTION_CATALOG}`,
  '- confidence: 0–1, how sure you are about kind and summary given the material.',
  '',
  'When an image is attached: describe what it shows (layout, subject, UI, colours, mood) in visualDescription and transcribe legible text into visibleText. Read the image before deciding kind: a screenshot of a product page is a screenshot unless the item itself is that page.'
].join('\n')

export function describeItem(input: UnderstandInput): string {
  const lines: string[] = []
  lines.push(`Title: ${input.title || '(untitled)'}`)
  lines.push(`Type: ${input.type}${input.subtype ? `/${input.subtype}` : ''}`)
  if (input.url) lines.push(`URL: ${input.url}`)
  if (input.domain) lines.push(`Domain: ${input.domain}`)
  if (input.mimeType) lines.push(`MIME: ${input.mimeType}`)
  if (input.capturedAt) lines.push(`Captured: ${input.capturedAt}`)
  if (input.metadata && Object.keys(input.metadata).length > 0) lines.push(jsonBlock('Metadata', input.metadata))
  if (input.children && input.children.length > 0) {
    lines.push(
      jsonBlock(
        'Children',
        input.children.slice(0, 40).map((child) => ({
          title: child.title,
          kind: child.kind ?? null,
          understanding: child.understanding ?? null
        }))
      )
    )
  }
  if (input.text && input.text.trim().length > 0) {
    lines.push('', 'Content:', clipText(input.text.trim(), LIMITS.understandTextChars))
  } else if (!input.images || input.images.length === 0) {
    lines.push('', 'Content: (no text could be extracted; work from the title, URL and metadata)')
  }
  return lines.join('\n')
}

export function buildUnderstandMessages(input: UnderstandInput): ChatMessage[] {
  const body = describeItem(input)
  const images = (input.images ?? []).filter((uri) => uri.startsWith('data:'))
  if (images.length === 0) return [systemMessage(UNDERSTAND_SYSTEM_PROMPT), userMessage(body)]
  const parts: ContentPart[] = [
    textPart(`${body}\n\nAttached: ${images.length === 1 ? 'one image' : `${images.length} images`} of this item.`)
  ]
  for (const uri of images) parts.push(imagePart(uri))
  return [systemMessage(UNDERSTAND_SYSTEM_PROMPT), userMessage(parts)]
}

export function buildUnderstandRequest(input: UnderstandInput, signal?: AbortSignal): ChatRequest {
  return { messages: buildUnderstandMessages(input), task: 'understand', signal }
}
