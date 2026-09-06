/**
 * Pure markdown parser for note heroes. Handles headings, paragraphs, lists, and inline
 * emphasis/links. No DOM, unit-tested under node.
 */

export type Span = { text: string; strong?: true; em?: true; code?: true }

export type Block =
  | { kind: 'h1' | 'h2' | 'p'; spans: Span[] }
  | { kind: 'list'; ordered: boolean; items: { spans: Span[]; nested: boolean }[] }

// ponytail: markdown links render as label only (URL dropped). The hero is not a browser —
// make them real anchors through system:openExternal if notes ever carry outbound links.
// `_` runs are guarded by word-boundary lookarounds so identifiers like file_name_here survive;
// `*` is not, because CommonMark does allow intraword `*` emphasis.
const INLINE =
  /(\*\*[^*\n]+\*\*|(?<![A-Za-z0-9_])__[^_\n]+__(?![A-Za-z0-9_])|`[^`\n]+`|\*[^*\n]+\*|(?<![A-Za-z0-9_])_[^_\n]+_(?![A-Za-z0-9_])|\[[^\]\n]+\]\([^)\n]+\))/g

/** Citation markers the agent emits (`[1]`) sometimes sit flush against the preceding word. */
const CITATION_GAP = /(\S)(\[\d+\])/g

export function parseInline(source: string): Span[] {
  const text = source.replace(CITATION_GAP, '$1 $2')
  const spans: Span[] = []
  let last = 0
  for (const match of text.matchAll(INLINE)) {
    const start = match.index ?? 0
    if (start > last) spans.push({ text: text.slice(last, start) })
    const tok = match[0]
    if (tok.startsWith('**') || tok.startsWith('__')) {
      spans.push({ text: tok.slice(2, -2), strong: true })
    } else if (tok.startsWith('`')) {
      spans.push({ text: tok.slice(1, -1), code: true })
    } else if (tok.startsWith('*') || tok.startsWith('_')) {
      spans.push({ text: tok.slice(1, -1), em: true })
    } else if (tok.startsWith('[')) {
      const label = tok.slice(1, tok.indexOf(']'))
      spans.push({ text: label })
    }
    last = start + tok.length
  }
  if (last < text.length) spans.push({ text: text.slice(last) })
  return spans.filter((s) => s.text.length > 0)
}

const LIST_ITEM = /^(\s*)(?:[-*+]|\d+\.)\s+(.*)$/

export function parseBlocks(source: string): Block[] {
  const normalised = source.replace(/\r\n/g, '\n')
  const chunks = normalised.split(/\n{2,}/)
  const blocks: Block[] = []

  for (const chunk of chunks) {
    const lines = chunk.split('\n')
    let paragraphLines: string[] = []
    let list: { ordered: boolean; items: { spans: Span[]; nested: boolean }[] } | null = null

    const flushParagraph = () => {
      if (paragraphLines.length === 0) return
      blocks.push({ kind: 'p', spans: parseInline(paragraphLines.join(' ').trim()) })
      paragraphLines = []
    }

    const flushList = () => {
      if (list === null || list.items.length === 0) {
        list = null
        return
      }
      blocks.push({ kind: 'list', ordered: list.ordered, items: list.items })
      list = null
    }

    for (const line of lines) {
      const match = line.match(LIST_ITEM)
      if (match && match[1] !== undefined && match[2] !== undefined) {
        const indent = match[1]
        const content = match[2]
        flushParagraph()
        const ordered = /^\s*\d+\.\s/.test(line)
        const nested = indent.length >= 2
        if (list === null) list = { ordered, items: [] }
        if (list.ordered !== ordered) {
          flushList()
          list = { ordered, items: [] }
        }
        list.items.push({ spans: parseInline(content), nested })
        continue
      }

      if (list !== null) flushList()

      const trimmed = line.trim()
      if (trimmed.length === 0) {
        flushParagraph()
        continue
      }

      // A heading interrupts an open paragraph; without the flush it reads as literal `## text`.
      if (trimmed.startsWith('# ')) {
        flushParagraph()
        blocks.push({ kind: 'h1', spans: parseInline(trimmed.slice(2)) })
        continue
      }
      if (/^#{2,6}\s/.test(trimmed)) {
        flushParagraph()
        blocks.push({ kind: 'h2', spans: parseInline(trimmed.replace(/^#{2,6}\s/, '')) })
        continue
      }

      paragraphLines.push(trimmed)
    }

    flushParagraph()
    flushList()
  }

  return blocks.filter((b) => {
    if (b.kind === 'list') return b.items.length > 0
    return b.spans.length > 0 && b.spans.some((s) => s.text.trim().length > 0)
  })
}
