/**
 * Limits, timeouts, defaults and product copy shared by main and renderer.
 *
 * Zero imports allowed in `src/shared/**`.
 */

/** Hard limits and tunables for extraction, chunking, previews, the agent and the scheduler. */
export const LIMITS = {
  /** `items.extracted_text` cap (chars). */
  maxExtractedChars: 60_000,
  /** Text handed to the understand task (chars). */
  understandTextChars: 12_000,
  /** Default `maxChars` of the `read_document` tool. */
  readDocumentChars: 8_000,
  /** `ItemSummary.understanding` truncation (chars). */
  summaryUnderstandingMaxChars: 160,
  /** `items.excerpt` cap (chars). */
  excerptChars: 280,
  /** Body chunk size for embeddings (MiniLM truncates around 256 wordpieces). */
  bodyChunkChars: 900,
  /** Maximum body chunks embedded per item. */
  maxBodyChunks: 24,
  /** Folder import: maximum files imported as children. */
  folderMaxFiles: 500,
  /** Folder import: maximum traversal depth. */
  folderMaxDepth: 4,
  /** Folder task: number of text files sampled. */
  folderSampleFiles: 20,
  /** Folder task: maximum bytes read per sampled file. */
  folderSampleFileBytes: 30_000,
  /** Skip body embeddings for children of folders with more files than this. */
  folderChildrenBodyEmbedLimit: 50,
  /** Thumbnail longest side (px). */
  thumbnailMaxPx: 800,
  /** URL snapshot viewport width (px). */
  snapshotWidth: 1280,
  /** URL snapshot viewport height (px). */
  snapshotHeight: 800,
  /** Snapshot load budget (ms). */
  snapshotTimeoutMs: 20_000,
  /** HTML fetch budget (ms). */
  fetchTimeoutMs: 15_000,
  /** One model call budget (ms). */
  aiTimeoutMs: 60_000,
  /** Batch organize runs at the latest this long after the first sibling was captured (ms). */
  batchGateMs: 90_000,
  /** Step cap for the single-item organize task. */
  organizeSteps: 5,
  /** Step cap for the batch organize task. */
  organizeBatchSteps: 10,
  /** Step cap for the command task (Ask, multi-item, actions). */
  commandSteps: 12,
  /** Prompt-token ceiling per run; reaching it forces `finish`. */
  runPromptTokenCeiling: 60_000,
  /** Vector-only hits below this cosine are dropped. */
  cosineFloor: 0.3,
  /** Same type and cosine at or above this = `duplicate_of` without a model call. */
  nearDuplicateCosine: 0.92,
  /** Collection name+description cosine above this = "too similar to an existing collection". */
  collectionSimilarityCosine: 0.85,
  /** Retry backoff per attempt (ms). */
  retryBackoffMs: [30_000, 120_000, 600_000],
  /** Maximum job attempts before `failed`. */
  maxAttempts: 3,
  /** Scheduler lane concurrency. */
  lanes: { io: 2, embed: 1, ai: 1 }
} as const

/** Directory names never traversed by the folder importer. */
export const SKIP_DIR_NAMES: readonly string[] = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.cache',
  '__pycache__',
  'Library',
  '.venv',
  'venv',
  '.next',
  '.turbo',
  'coverage',
  'DerivedData',
  'Pods',
  '.Trash'
]

/** Path fragments that mark macOS temporary locations (drops from browsers etc.): always copy. */
export const TEMP_PATH_MARKERS: readonly string[] = ['/private/var/folders', 'TemporaryItems']

/** Product copy. Functions take the variable part. */
export const COPY = {
  tagline: 'Keep anything.',
  taglineRest: "We'll figure out the rest.",
  saved: 'Saved.',
  foundRelated: (n: number): string => (n === 1 ? 'Found 1 related thing.' : `Found ${n} related things.`),
  alreadyKept: (ago: string): string => `Already kept · ${ago}`,
  cantReadPage: "Couldn't read this page, but the link is safe.",
  stillFiguring: 'Still figuring this one out.',
  nothingWaiting: 'Nothing waiting.',
  emptyCollection: 'Nothing here yet. Drag things in or let it fill up.',
  trashEmpty: 'Trash is empty.',
  noMatches: (q: string): string => `Nothing matches "${q}".`,
  askNothing: "Couldn't find anything about that.",
  dropHint: 'Drop anywhere',
  /** The shelf's own headline: it exists to be dropped on, so it says so. */
  dropHere: 'Drop here',
  dropSub: 'Keep it for later',
  pasteHint: 'Paste a link (⌘V)',
  localOnly: 'Local only',
  localConnected: 'Local · GMI connected',
  localOffline: 'Local · offline — AI paused',
  notUnderstood: 'Kept. Not understood yet.',
  connectHint: 'Connect GMI in Settings to understand this.'
} as const

/** Default reasoning model (GMI Cloud). */
export const DEFAULT_MODEL = 'MiniMaxAI/MiniMax-M3'

/** Default OpenAI-compatible base URL. */
export const DEFAULT_BASE_URL = 'https://api.gmi-serving.com/v1'

/** Local embedding model id (Hugging Face hub layout under `models/`). */
export const EMBEDDING_MODEL_ID = 'Xenova/all-MiniLM-L6-v2'

/** Embedding vector size for `EMBEDDING_MODEL_ID` and the hash fallback. */
export const EMBEDDING_DIMS = 384

/** Custom protocol serving files from the library (`ka-media://local/...`). */
export const MEDIA_SCHEME = 'ka-media'

/** DataTransfer MIME type for drags of items inside the app. */
export const INTERNAL_DND_MIME = 'application/x-keepanything-items'
