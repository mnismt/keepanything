/**
 * Pure helpers for the command palette: grouping quick-search hits by type, deciding when the
 * "Ask" row shows, and turning agent steps into the evidence header. No DOM, unit-tested.
 */
import { isProbablyNaturalLanguage } from '../../../shared/text'
import type { AgentCues, AgentStep, ItemType, SearchHit } from '../../../shared/types'

/** Display groups for palette hits, in order. */
export type HitGroupId = 'links' | 'images' | 'documents' | 'files' | 'notes'

export interface HitGroup {
  id: HitGroupId
  label: string
  hits: SearchHit[]
}

const GROUP_LABEL: Record<HitGroupId, string> = {
  links: 'Links',
  images: 'Images',
  documents: 'Documents',
  files: 'Files',
  notes: 'Notes'
}

const GROUP_ORDER: readonly HitGroupId[] = ['links', 'documents', 'images', 'notes', 'files']

export function groupForType(type: ItemType): HitGroupId {
  switch (type) {
    case 'url':
      return 'links'
    case 'image':
    case 'video':
      return 'images'
    case 'pdf':
    case 'text':
    case 'markdown':
      return 'documents'
    case 'note':
      return 'notes'
    default:
      return 'files'
  }
}

/**
 * Group hits by type while keeping the rank order inside each group. Groups appear in the order of
 * their best-ranked hit so the top result is always first on screen; empty groups are dropped.
 */
export function groupHits(hits: readonly SearchHit[]): HitGroup[] {
  const byGroup = new Map<HitGroupId, SearchHit[]>()
  for (const hit of hits) {
    const id = groupForType(hit.type)
    const list = byGroup.get(id)
    if (list) list.push(hit)
    else byGroup.set(id, [hit])
  }
  return [...byGroup.entries()]
    .sort(
      (a, b) =>
        hits.indexOf(a[1][0] as SearchHit) - hits.indexOf(b[1][0] as SearchHit) ||
        GROUP_ORDER.indexOf(a[0]) - GROUP_ORDER.indexOf(b[0])
    )
    .map(([id, list]) => ({ id, label: GROUP_LABEL[id], hits: list }))
}

/**
 * The evidence snippet under a hit: the FTS snippet when present, otherwise the understanding,
 * otherwise the domain. Never empty when the hit has any of them.
 */
export function hitSnippet(hit: { snippet?: string; understanding?: string | null; domain?: string | null }): string {
  return hit.snippet?.trim() || hit.understanding?.trim() || hit.domain || ''
}

/**
 * The "Ask" row shows for a non-empty query when there are no local hits, or when the query reads
 * like natural language.
 */
export function shouldOfferAsk(query: string, hitCount: number): boolean {
  const q = query.trim()
  if (q.length === 0) return false
  return hitCount === 0 || isProbablyNaturalLanguage(q)
}

/** Short human verb for a tool name; falls back to a cleaned-up tool id. */
export function toolLabel(tool: string): string {
  switch (tool) {
    case 'search_library':
    case 'semantic_search':
      return 'Searched'
    case 'list_items':
    case 'topic_overview':
      return 'Surveyed'
    case 'inspect_item':
    case 'inspect_folder':
    case 'inspect_collection':
    case 'list_collections':
      return 'Inspected'
    case 'read_document':
    case 'search_in_item':
      return 'Read'
    case 'get_related_items':
      return 'Followed links'
    case 'compare':
      return 'Compared'
    case 'create_collection':
    case 'add_to_collection':
    case 'rename_collection':
    case 'create_relationship':
    case 'update_item_understanding':
    case 'create_note':
    case 'suggest_action':
      return 'Wrote'
    case 'finish':
      return 'Answered'
    default:
      return tool.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
  }
}

/** Compact elapsed time: `0.4s`, `12s`, `1m 05s`. */
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0s'
  if (ms < 10_000) return `${(ms / 1000).toFixed(1).replace(/\.0$/, '')}s`
  const total = Math.round(ms / 1000)
  if (total < 60) return `${total}s`
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}m ${s.toString().padStart(2, '0')}s`
}

/**
 * Evidence header from structured facts only (never model text): "Looked at 7 items · Read 3 ·
 * Theme: inference cost · Last month". Returns an empty string when nothing is known.
 */
export function evidenceHeader(steps: readonly AgentStep[], cues?: AgentCues): string {
  const parts: string[] = []
  const looked = new Set<string>()
  const read = new Set<string>()
  for (const step of steps) {
    if (step.status !== 'ok') continue
    for (const id of step.itemIds ?? []) {
      if (step.kind === 'search' || step.kind === 'inspect' || step.kind === 'compare') looked.add(id)
      if (step.kind === 'read') {
        read.add(id)
        looked.add(id)
      }
    }
  }
  if (looked.size > 0) parts.push(`Looked at ${looked.size} ${looked.size === 1 ? 'item' : 'items'}`)
  if (read.size > 0) parts.push(`Read ${read.size}`)
  const writes = steps.filter((s) => s.status === 'ok' && s.kind === 'write').length
  if (writes > 0) parts.push(writes === 1 ? '1 change' : `${writes} changes`)
  if (cues) {
    if (cues.topics.length > 0) parts.push(`Theme: ${cues.topics.slice(0, 3).join(', ')}`)
    if (cues.timeframe?.label) parts.push(cues.timeframe.label)
  }
  return parts.join(' · ')
}

/** Title for a "Save as note" capture: the question, trimmed and capped. */
export function noteTitleFor(question: string): string {
  const q = question
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[?.!]+$/, '')
  if (q.length === 0) return 'Answer'
  return q.length > 72 ? `${q.slice(0, 71).trimEnd()}…` : q
}

/** Markdown body for a saved answer: the answer plus a sources list. */
export function noteBodyFor(question: string, answer: string, sources: readonly { title: string }[]): string {
  const lines = [`# ${noteTitleFor(question)}`, '', answer.trim()]
  if (sources.length > 0) {
    lines.push('', '## Sources', '')
    for (const s of sources) lines.push(`- ${s.title}`)
  }
  return lines.join('\n')
}
