/**
 * In-memory fixture library for the dev MockBridge. Covers every ItemType, every user-visible
 * status, the three collection types, relationships and an agent run. Thumbnails are inline SVG
 * data URLs (allowed by the CSP) so the shell looks real in a plain browser.
 */

import { DEFAULT_BASE_URL, DEFAULT_MODEL } from '../../../shared/constants'
import type {
  AgentRunDetail,
  CollectionSummary,
  Item,
  ItemSummary,
  ItemType,
  JobProgress,
  ProcessingStatus,
  Relationship,
  Settings
} from '../../../shared/types'

const NOW = Date.now()
const minutes = (n: number): string => new Date(NOW - n * 60_000).toISOString()
const hours = (n: number): string => minutes(n * 60)
const days = (n: number): string => hours(n * 24)

type Motif = 'circle' | 'bars' | 'grid' | 'arc' | 'none'

export function svgThumb(w: number, h: number, bg: string, fg: string, motif: Motif = 'none'): string {
  let shape = ''
  const cx = w / 2
  const cy = h / 2
  switch (motif) {
    case 'circle':
      shape = `<circle cx="${cx}" cy="${cy}" r="${Math.min(w, h) * 0.28}" fill="${fg}"/>`
      break
    case 'bars':
      shape = [0.25, 0.45, 0.65]
        .map(
          (f, i) =>
            `<rect x="${w * 0.18}" y="${h * f}" width="${w * (0.64 - i * 0.14)}" height="${h * 0.06}" rx="3" fill="${fg}"/>`
        )
        .join('')
      break
    case 'grid':
      shape = [0, 1, 2]
        .flatMap((r) =>
          [0, 1, 2].map(
            (c) =>
              `<rect x="${w * (0.22 + c * 0.2)}" y="${h * (0.22 + r * 0.2)}" width="${w * 0.14}" height="${h * 0.14}" rx="4" fill="${fg}"/>`
          )
        )
        .join('')
      break
    case 'arc':
      shape = `<path d="M ${w * 0.15} ${h * 0.75} A ${w * 0.4} ${w * 0.4} 0 0 1 ${w * 0.85} ${h * 0.75}" stroke="${fg}" stroke-width="${Math.max(4, w * 0.03)}" fill="none" stroke-linecap="round"/>`
      break
    default:
      break
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${bg}"/>${shape}</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export interface Seed {
  id: string
  type: ItemType
  subtype?: ItemSummary['subtype']
  kind?: ItemSummary['kind']
  title: string
  domain?: string
  url?: string
  status?: ProcessingStatus
  understanding?: string
  whyUseful?: string
  excerpt?: string
  width?: number
  height?: number
  size?: number
  pageCount?: number
  durationMs?: number
  capturedAt: string
  color?: string
  motif?: Motif
  fg?: string
  thumb?: boolean
  childCount?: number
  card?: ItemSummary['card']
  isMissing?: boolean
  error?: string
  collectionIds?: string[]
}

const SEEDS: Seed[] = [
  {
    id: 'it-01',
    type: 'url',
    subtype: 'article',
    kind: 'article',
    title: 'Batching strategies for LLM inference serving',
    domain: 'anyscale.com',
    url: 'https://www.anyscale.com/blog/continuous-batching-llm-inference',
    status: 'READY',
    width: 1280,
    height: 800,
    capturedAt: hours(3),
    color: '#2b3a4a',
    fg: '#c9d6e2',
    motif: 'bars',
    understanding:
      'An engineering article comparing static and continuous batching for LLM serving, with throughput numbers on A100s.',
    whyUseful: 'Reference for cutting GPU serving cost when the inference research turns into a decision.',
    collectionIds: ['col-ai']
  },
  {
    id: 'it-02',
    type: 'url',
    subtype: 'github_repo',
    kind: 'cli_tool',
    title: 'vllm-project/vllm',
    domain: 'github.com',
    url: 'https://github.com/vllm-project/vllm',
    status: 'READY',
    capturedAt: hours(5),
    color: '#1f2a24',
    fg: '#9cc4a8',
    thumb: false,
    understanding:
      'The vLLM inference engine repository: PagedAttention, continuous batching, OpenAI-compatible server.',
    whyUseful: 'The default open-source option to compare hosted providers against.',
    card: {
      language: 'Python',
      stars: 48210,
      description: 'A high-throughput and memory-efficient inference and serving engine for LLMs',
      owner: 'vllm-project'
    },
    collectionIds: ['col-ai']
  },
  {
    id: 'it-03',
    type: 'pdf',
    kind: 'paper',
    title: 'Efficient Memory Management for LLM Serving with PagedAttention',
    status: 'READY',
    width: 612,
    height: 792,
    size: 2_412_000,
    pageCount: 18,
    capturedAt: hours(6),
    color: '#ece7dd',
    fg: '#b9b1a3',
    motif: 'bars',
    understanding:
      'The PagedAttention paper (SOSP 2023). Introduces block-level KV cache management and reports 2–4× throughput over prior systems.',
    whyUseful: 'Primary source behind the vLLM numbers quoted everywhere.',
    collectionIds: ['col-ai', 'col-read']
  },
  {
    id: 'it-04',
    type: 'image',
    subtype: 'screenshot',
    kind: 'screenshot',
    title: 'Linear settings - appearance panel',
    status: 'READY',
    width: 1440,
    height: 1020,
    size: 812_000,
    capturedAt: hours(8),
    color: '#26232a',
    fg: '#57515f',
    motif: 'grid',
    understanding:
      'Screenshot of Linear’s appearance settings: theme picker, accent swatches, dense typography on a near-black surface.',
    whyUseful: 'Reference for how a settings sheet can stay quiet.',
    collectionIds: ['col-design']
  },
  {
    id: 'it-05',
    type: 'image',
    subtype: 'design',
    kind: 'design_reference',
    title: 'Editorial landing hero exploration',
    status: 'READY',
    width: 1600,
    height: 2000,
    size: 1_950_000,
    capturedAt: days(1),
    color: '#d9cdb8',
    fg: '#8a7b64',
    motif: 'arc',
    understanding: 'A warm, paper-toned landing hero with a single serif headline and generous margins; no UI chrome.',
    whyUseful: 'Visual direction candidate for a quiet, editorial landing page.',
    collectionIds: ['col-design', 'col-moodboard']
  },
  {
    id: 'it-06',
    type: 'video',
    kind: 'video',
    title: 'SKUD intro video',
    status: 'READY',
    width: 1920,
    height: 1080,
    size: 48_200_000,
    durationMs: 94_000,
    capturedAt: days(2),
    color: '#141a22',
    fg: '#3f5470',
    motif: 'circle',
    understanding: 'A 94-second product intro with slow camera moves over hardware and a restrained voiceover.',
    whyUseful: 'Tone reference for premium software advertising.',
    collectionIds: ['col-moodboard']
  },
  {
    id: 'it-07',
    type: 'folder',
    title: 'inference-benchmarks',
    status: 'READY',
    childCount: 23,
    size: 12_400_000,
    capturedAt: days(2),
    color: '#2a2622',
    fg: '#4a443d',
    motif: 'grid',
    understanding: 'A folder of CSV benchmark results and two notebooks comparing token throughput across providers.',
    whyUseful: 'Raw numbers for the inference comparison.',
    collectionIds: ['col-ai']
  },
  {
    id: 'it-08',
    type: 'markdown',
    kind: 'note',
    title: 'Cheap inference providers - notes',
    status: 'READY',
    size: 6_200,
    capturedAt: days(3),
    thumb: false,
    excerpt:
      'Together, Fireworks, GMI and DeepInfra all quote per-token prices; what differs is cold-start behaviour, tool-calling support and rate-limit headroom. GMI’s MiniMax endpoint is OpenAI-compatible…',
    understanding:
      'Personal notes comparing hosted inference providers on price, cold starts and tool-calling support.',
    whyUseful: 'The working comparison that the agent can extend.',
    collectionIds: ['col-ai']
  },
  {
    id: 'it-09',
    type: 'text',
    title: 'Pasted text',
    status: 'PARTIAL',
    size: 900,
    capturedAt: days(21),
    thumb: false,
    excerpt:
      'Remember to check whether Resend has a free tier that covers 3k emails a month, and what the alternatives are - Postmark, Loops, Plunk.',
    understanding: 'A short reminder about email-provider alternatives to Resend.'
  },
  {
    id: 'it-10',
    type: 'url',
    subtype: 'youtube',
    kind: 'video',
    title: 'How Raycast builds native-feeling UI',
    domain: 'youtube.com',
    url: 'https://www.youtube.com/watch?v=abc',
    status: 'READY',
    width: 1280,
    height: 720,
    durationMs: 1_845_000,
    capturedAt: days(4),
    color: '#1c1c1c',
    fg: '#5a5a5a',
    motif: 'circle',
    understanding:
      'A talk on how Raycast keeps a web-rendered app feeling native: latency budgets, keyboard-first flows, restrained motion.',
    whyUseful: 'Design principles to borrow for KeepAnything.',
    collectionIds: ['col-design']
  },
  {
    id: 'it-11',
    type: 'url',
    subtype: 'product',
    kind: 'saas_product',
    title: 'GMI Cloud - inference engine',
    domain: 'gmicloud.ai',
    url: 'https://www.gmicloud.ai/',
    status: 'UNDERSTANDING',
    width: 1280,
    height: 800,
    capturedAt: minutes(2),
    color: '#1e2430',
    fg: '#3b475c',
    motif: 'arc'
  },
  {
    id: 'it-12',
    type: 'file',
    subtype: 'spreadsheet',
    title: 'provider-pricing.xlsx',
    status: 'CAPTURED',
    size: 44_000,
    capturedAt: minutes(1),
    thumb: false
  },
  {
    id: 'it-13',
    type: 'url',
    subtype: 'generic',
    title: 'example.com/paywalled',
    domain: 'example.com',
    url: 'https://example.com/paywalled',
    status: 'EXTRACTION_FAILED',
    capturedAt: hours(1),
    thumb: false,
    error: 'The page returned 403.'
  },
  {
    id: 'it-14',
    type: 'audio',
    title: 'voice-memo-0412.m4a',
    status: 'WAITING_FOR_AI',
    size: 3_100_000,
    durationMs: 212_000,
    capturedAt: hours(2),
    thumb: false
  },
  {
    id: 'it-15',
    type: 'note',
    kind: 'note',
    title: 'Inference providers - comparison',
    status: 'READY',
    capturedAt: hours(4),
    thumb: false,
    excerpt:
      'Across the five saved sources, hosted providers separate on three axes: price per million tokens, cold-start latency and tool-calling reliability. vLLM self-hosting wins on control…',
    understanding: 'A generated comparison note citing four saved sources.',
    collectionIds: ['col-ai']
  },
  {
    id: 'it-16',
    type: 'unknown',
    title: 'firmware.bin',
    status: 'AI_FAILED',
    size: 8_400_000,
    capturedAt: days(6),
    thumb: false,
    error: 'The model returned nothing usable.'
  },
  {
    id: 'it-17',
    type: 'image',
    subtype: 'photo',
    kind: 'photo',
    title: 'IMG_2291.heic',
    status: 'READY',
    width: 3024,
    height: 4032,
    size: 2_800_000,
    capturedAt: days(9),
    color: '#3a2f28',
    fg: '#6b5a4c',
    motif: 'circle',
    understanding: 'A photo of a bookshelf with design monographs, taken in warm indoor light.',
    isMissing: true
  },
  {
    id: 'it-18',
    type: 'url',
    subtype: 'docs',
    kind: 'docs',
    title: 'Electron - utilityProcess',
    domain: 'electronjs.org',
    url: 'https://www.electronjs.org/docs/latest/api/utility-process',
    status: 'READY',
    width: 1280,
    height: 800,
    capturedAt: days(12),
    color: '#23282e',
    fg: '#47515c',
    motif: 'bars',
    understanding: 'Electron docs for utilityProcess: forking Node child processes from main with MessagePort IPC.',
    whyUseful: 'How the embedding worker is wired.'
  }
]

const TEXTUAL: ReadonlySet<ItemType> = new Set(['text', 'markdown', 'note', 'file', 'audio', 'unknown'])

function toSummary(s: Seed): ItemSummary {
  const w = s.width ?? 640
  const h = s.height ?? 400
  const showThumb = s.thumb !== false && !TEXTUAL.has(s.type)
  const tw = Math.min(w, 800)
  const thumb = showThumb
    ? svgThumb(tw, Math.round((tw * h) / w), s.color ?? '#2a2622', s.fg ?? '#4a443d', s.motif ?? 'none')
    : null
  const summary: ItemSummary = {
    id: s.id,
    type: s.type,
    subtype: s.subtype ?? null,
    kind: s.kind ?? null,
    title: s.title,
    domain: s.domain ?? null,
    url: s.url ?? null,
    thumbnailUrl: thumb,
    snapshotUrl: s.type === 'url' ? thumb : null,
    faviconUrl: null,
    dominantColor: s.color ?? null,
    width: s.width ?? null,
    height: s.height ?? null,
    size: s.size ?? null,
    mimeType: null,
    durationMs: s.durationMs ?? null,
    pageCount: s.pageCount ?? null,
    excerpt: s.excerpt ?? null,
    capturedAt: s.capturedAt,
    createdAt: s.capturedAt,
    processingStatus: s.status ?? 'READY',
    processingError: s.error ?? null,
    understanding: s.understanding ?? null,
    collectionIds: s.collectionIds ?? [],
    childCount: s.childCount ?? 0,
    childThumbnailUrls:
      s.type === 'folder'
        ? [
            svgThumb(200, 150, '#ece7dd', '#b9b1a3', 'bars'),
            svgThumb(200, 150, '#2b3a4a', '#c9d6e2', 'grid'),
            svgThumb(200, 150, '#26232a', '#57515f', 'circle'),
            svgThumb(200, 150, '#d9cdb8', '#8a7b64', 'arc')
          ]
        : [],
    isMissing: s.isMissing ?? false,
    parentItemId: null
  }
  if (s.card) summary.card = s.card
  return summary
}

export const FIXTURE_ITEMS: ItemSummary[] = SEEDS.map(toSummary)

export const SEED_BY_ID: ReadonlyMap<string, Seed> = new Map(SEEDS.map((s) => [s.id, s]))

/** Full row for `items:get`, derived from the summary. */
export function toItem(summary: ItemSummary, seed?: Seed): Item {
  return {
    id: summary.id,
    type: summary.type,
    subtype: summary.subtype,
    kind: summary.kind,
    title: summary.title,
    originalPath: summary.type === 'url' || summary.type === 'note' ? null : `/Users/you/Desktop/${summary.title}`,
    managedPath: null,
    url: summary.url,
    canonicalUrl: summary.url,
    domain: summary.domain,
    mimeType: summary.mimeType,
    size: summary.size,
    contentHash: null,
    width: summary.width,
    height: summary.height,
    durationMs: summary.durationMs,
    pageCount: summary.pageCount,
    createdAt: summary.createdAt,
    capturedAt: summary.capturedAt,
    modifiedAt: summary.capturedAt,
    lastKeptAt: summary.capturedAt,
    captureBatchId: null,
    processingStatus: summary.processingStatus,
    processingError: summary.processingError,
    understanding: summary.understanding,
    whyUseful: seed?.whyUseful ?? null,
    topics: [],
    entities: [],
    visionText: null,
    retrievalHints: [],
    aiConfidence: summary.understanding ? 0.82 : null,
    metadata: {},
    extractedText: null,
    excerpt: summary.excerpt,
    thumbnailPath: null,
    snapshotPath: null,
    faviconPath: null,
    dominantColor: summary.dominantColor,
    mediaVersion: 1,
    parentItemId: null,
    userOverrides: {},
    isMissing: summary.isMissing,
    missingCheckedAt: null,
    deletedAt: null
  }
}

function col(
  id: string,
  name: string,
  type: CollectionSummary['type'],
  createdBy: CollectionSummary['createdBy'],
  description: string | null
): CollectionSummary {
  return {
    id,
    name,
    nameKey: name.toLowerCase(),
    description,
    type,
    query: type === 'dynamic' ? { text: 'things worth reading later', filters: {}, minCosine: 0.4 } : null,
    createdBy,
    color: null,
    pinned: false,
    createdAt: days(7),
    updatedAt: hours(3),
    count: 0,
    coverThumbnailUrls: []
  }
}

export const FIXTURE_COLLECTIONS: CollectionSummary[] = [
  col('col-ai', 'Local LLM inference research', 'ai', 'agent', 'Serving engines, providers and cost comparisons.'),
  col('col-design', 'macOS utility references', 'ai', 'agent', 'Quiet, native-feeling desktop UI.'),
  col('col-moodboard', 'Editorial moodboard', 'manual', 'user', null),
  col('col-read', 'Things to read', 'dynamic', 'user', 'Anything that looks like long-form reading.')
]

export const FIXTURE_RELATIONSHIPS: Relationship[] = [
  {
    id: 'rel-1',
    sourceItemId: 'it-01',
    targetItemId: 'it-02',
    type: 'related_to',
    description: 'Both are about continuous batching.',
    confidence: 0.86,
    evidence: null,
    createdBy: 'agent',
    agentRunId: 'run-seed',
    createdAt: hours(3)
  },
  {
    id: 'rel-2',
    sourceItemId: 'it-02',
    targetItemId: 'it-03',
    type: 'references',
    description: 'vLLM implements PagedAttention.',
    confidence: 0.93,
    evidence: { itemId: 'it-03', quote: 'PagedAttention, an attention algorithm inspired by virtual memory' },
    createdBy: 'agent',
    agentRunId: 'run-seed',
    createdAt: hours(5)
  },
  {
    id: 'rel-3',
    sourceItemId: 'it-15',
    targetItemId: 'it-08',
    type: 'created_from',
    description: null,
    confidence: 1,
    evidence: null,
    createdBy: 'agent',
    agentRunId: 'run-seed',
    createdAt: hours(4)
  },
  {
    id: 'rel-4',
    sourceItemId: 'it-05',
    targetItemId: 'it-06',
    type: 'same_project',
    description: 'Shared theme: premium software advertising.',
    confidence: 0.71,
    evidence: null,
    createdBy: 'agent',
    agentRunId: 'run-seed',
    createdAt: days(1)
  }
]

export const FIXTURE_SETTINGS: Settings = {
  aiMode: 'mock',
  model: DEFAULT_MODEL,
  baseUrl: DEFAULT_BASE_URL,
  hasApiKey: false,
  apiKeyMasked: null,
  importMode: 'copy',
  theme: 'system',
  libraryPath: '/Users/you/Library/Application Support/KeepAnything/dev',
  embeddings: { provider: 'minilm', modelPresent: true, dims: 384 }
}

export const FIXTURE_JOBS: JobProgress[] = [
  {
    itemId: 'it-11',
    batchId: null,
    processingStatus: 'UNDERSTANDING',
    stage: 'understand',
    jobStatus: 'running',
    attempts: 1
  },
  { itemId: 'it-12', batchId: null, processingStatus: 'CAPTURED', stage: 'extract', jobStatus: 'queued', attempts: 0 }
]

export const FIXTURE_RUN: AgentRunDetail = {
  id: 'run-seed',
  itemId: 'it-01',
  batchId: null,
  task: 'organize',
  status: 'succeeded',
  model: DEFAULT_MODEL,
  startedAt: hours(3),
  completedAt: hours(3),
  stepCount: 3,
  error: null,
  undoable: true,
  steps: [
    {
      n: 1,
      tool: 'search_library',
      kind: 'search',
      label: 'Looked for related items about batching',
      itemIds: ['it-02', 'it-03'],
      status: 'ok',
      durationMs: 140
    },
    {
      n: 2,
      tool: 'inspect_item',
      kind: 'inspect',
      label: 'Read vllm-project/vllm',
      itemIds: ['it-02'],
      status: 'ok',
      durationMs: 90
    },
    {
      n: 3,
      tool: 'add_to_collection',
      kind: 'write',
      label: 'Added to Local LLM inference research',
      itemIds: ['it-01'],
      status: 'ok',
      durationMs: 20
    }
  ],
  usage: { promptTokens: 4200, completionTokens: 380, calls: 2, latencyMs: 3900 },
  result: {
    task: 'organize',
    itemId: 'it-01',
    relationshipIds: ['rel-1'],
    collectionIds: ['col-ai'],
    summary: 'Related to vLLM and PagedAttention; added to Local LLM inference research.'
  }
}
