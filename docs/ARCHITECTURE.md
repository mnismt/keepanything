# KeepAnything Architecture

> Keep anything. We'll figure out the rest.

KeepAnything is a local-first macOS desktop library. Users throw files, folders, screenshots, PDFs, links and text
at it. Originals are preserved. A reasoning agent (MiniMax-M3 via GMI Cloud) understands each item, relates it to the
existing library and organizes it into semantic collections. Retrieval works the way humans remember ("that mac app I
saved a few weeks ago"). Read `docs/PRODUCT_BRIEF.md` for the product.

American spelling in code identifiers (`organize`, `summarize`).

---

## Decisions

The reasoning behind these, one file per decision: `docs/decisions/` (see its README for the index).

| Topic | Decision | Why |
| --- | --- | --- |
| Desktop shell | **Electron 44** with the existing toolchain (electron-vite 5, React 19, TS 5.9 strict, Vitest, Playwright, electron-builder) | Working pipeline in repo; Tauri = Rust rewrite with no product upside. |
| Database | **`node:sqlite`** `DatabaseSync` (SQLite 3.53, FTS5 + JSON1) | Verified inside Electron 44 (Node 24.19). Zero native deps. Unit tests run on system Node ≥ 24. |
| Reasoning model | **`MiniMaxAI/MiniMax-M3`** via GMI Cloud, OpenAI-compatible `POST https://api.gmi-serving.com/v1/chat/completions` | Free tier. Verified: tool calling works, vision works (`image_url` data URIs), 1M ctx. `response_format: json_schema` is **not enforced** (fenced JSON comes back) → extract + zod + retry. |
| Embeddings | **Local** `@huggingface/transformers` `Xenova/all-MiniLM-L6-v2` (q8, 384-d) running in a **utilityProcess worker**. Model files shipped with the app (`build/models`, fetched by a script) and seeded into `<userData>/models`; remote download only as fallback. Deterministic hashed TF-IDF vector (`local-hash`, 384-d) as a last-resort fallback. | GMI has no embeddings endpoint. MiniLM verified in Electron. |
| Vector search | In-memory normalized `Float32Array` matrix in main (loaded from `embeddings` BLOBs at startup, appended on upsert); dot products per query; filtered by `model` | ~23 MB at 15k×384; sub-10 ms queries. |
| Full-text search | SQLite **FTS5**, normal content-storing table `items_fts` with `item_id UNINDEXED`, `tokenize='porter unicode61 remove_diacritics 2'`, `prefix='2 3'`, synced explicitly by the item repository (DELETE+INSERT in the same transaction) | Contentless/external-content variants break DELETE / snippet / rowid stability. |
| Thumbnails | `/usr/bin/qlmanage -t -s 800 -o <dir> <file>` (aspect-preserving, all QuickLook types, ~80 ms) for PDFs, video, HEIC, docs, unknown; `nativeImage.createFromPath().resize()` for PNG/JPEG/GIF/WebP; `createThumbnailFromPath` only with a known aspect ratio (it stretches to the requested size) | Verified on Electron 44. |
| URL snapshots | Offscreen `BrowserWindow` (`offscreen:true`, `sandbox`, throwaway partition `snapshot`, `disableDialogs`, downloads blocked, no will-navigate blocker), `transparent:false`, white bg, 1280×800, race load vs 20 s, `fonts.ready` + 700 ms settle, `capturePage()` → PNG (`snapshots/<id>.png`), optional full-page JPEG (`<id>.full.jpg`, ≤ 8 MB) since `nativeImage` has no WebP encoder; one reusable window | Verified. |
| Package manager | **pnpm**, hoisted layout (`node-linker=hoisted`) | Repo convention; electron-builder needs a real node_modules tree. |
| Dependencies | `dependencies` = only what must exist at runtime unbundled: `@huggingface/transformers` (pulls `onnxruntime-node`, `sharp`). Everything else (zod, linkedom, @mozilla/readability, turndown, unpdf, mime, zustand, cmdk, lucide-react, react…) stays in `devDependencies` and is bundled by Vite/rollup. `asarUnpack` for onnxruntime-node/sharp/@img. | Smaller app, fewer resolution surprises. |
| Secrets | `.env` (gitignored) → `KEEPANYTHING_GMI_API_KEY` etc. Runtime key stored with `safeStorage` in `<userData>/config.json` (loaded only after `app.whenReady()`; decrypt failure = "no key", never a crash). Dev uses `<userData>/dev` so dev and packaged builds never share a library. | No secrets in git; Keychain identity differs between dev and packaged. |
| Global "Yoink" drag interception | **Not visible to Electron**, which only sees drags that enter its own windows. A ~70-line Swift sidecar (`native/drag-watch`, built by `pnpm run native`, shipped via `extraResources`) polls `NSEvent.pressedMouseButtons` and, while a button is held, `NSPasteboard(name: .drag).changeCount`: every drag session writes its payload to that pasteboard as it begins, so a bump means a drag is in flight. Only the change count and type *names* are read, never the data, so no entitlement and no permission prompt. It emits NDJSON on stdout; main turns that into `armShelf` / `disarmShelf`. Fallbacks when the binary is absent: tray `drag-enter`, tray click, ⌘⇧K, ⌘V, whole-window drop overlay. | Measured idle cost 0.075% of one core, 10 MB RSS. |
| Threading | CPU-heavy work (MiniLM inference, PDF text via unpdf, readability→markdown, sha256 of big files) runs in a `utilityProcess` worker (`out/main/worker.js`, lazily spawned, idle-terminated, restarted on crash with the job re-queued). Main keeps SQLite (single writer), IPC, windows, thumbnails (qlmanage/nativeImage), snapshots. | Never freeze the UI thread. |

---

## 1. Process & module layout

```
src/
  shared/                      ZERO imports (no node, no DOM, no zod). Types + constants only.
    types.ts                   Item, ItemSummary, ItemDetail, Collection*, Relationship*, AgentRun*, AgentResult, SearchHit, Candidate, Settings, JobProgress, CaptureResult …
    ipc.ts                     IPC_CHANNELS, IpcRequest<C>/IpcResponse<C> maps, IPC_EVENTS payloads, IpcErrorCode, error envelope
    status.ts                  PROCESSING_STATUSES, isFailed(), USER_STAGES, STATUS_LABEL/STAGE_LABEL copy, transition table next(status, stage, outcome)
    actions.ts                 ITEM_ACTIONS (id, label, appliesTo) — the closed action vocabulary shared by UI and agent
    kinds.ts                   KINDS closed vocabulary for Understanding.kind; RELATIONSHIP_TYPES with inverse/symmetric map + labels
    constants.ts               limits (folder traversal, text caps, chunking), timeouts, product copy strings
    media.ts                   toMediaUrl(root, relPath, version) → `ka-media://local/<root>/<encoded>?v=<version>`
    text.ts                    pure helpers (truncate, slugify, relativeTime, formatBytes)

  main/
    index.ts                   bootstrap (see §7): scheme registration, dev userData, single instance, config, db, services, windows, tray, ipc, scheduler
    env.ts                     isDev, e2eMode, debugMode, aiMode ('gmi' | 'mock' | 'off')
    ports.ts                   TS interfaces for every seam: Intake, Retrieval, AgentService, AIProvider, EmbeddingProvider, Thumbnailer, Snapshotter, PageFetcher, Clock, Paths, SecretStore, WorkerClient, EventBus
    core/                      pure domain services (no electron, no process.env)
      errors.ts                KaError(code: IpcErrorCode, message, details?)
      events.ts                typed in-process EventBus (item.created/updated/trashed…, job.progress, agent.run, collections.changed)
      item-service.ts          create/patch/trash/restore/deleteForever; applyUnderstanding() honours user_overrides; indexed-field writes → FTS sync + `index` job; missing-file cache
      collection-service.ts    CRUD, membership (confidence/reason/actor), dynamic collection materialization hook, suppression on user removal (two keys), rename
      relationship-service.ts  create/remove (symmetric types stored source<target), suppression (unordered pair), inverse labels
      audit.ts                 audit_log writes; undo(auditId) applies `before`, sets undone_at, writes suppression for agent facts
    storage/
      paths.ts                 userData layout: library.db, objects/, thumbs/, snapshots/, content/, models/, logs/, url-cache/
      db.ts                    openDatabase(path), PRAGMAs (WAL, foreign_keys, busy_timeout), migrate(), `transaction(fn)` (BEGIN IMMEDIATE / SAVEPOINT nesting; NO await inside)
      migrations/001-init.sql  full schema (§2), versioned in schema_migrations
      repositories/            item-repo (incl. FTS sync + summaries), collection-repo, relationship-repo, embedding-repo, agent-run-repo, job-repo, audit-repo, suppression-repo
      object-store.ts          managed copies objects/<itemId>/<safe-name>; streaming sha256 (worker for >8 MB); exists/missing checks
    capture/                   [slice 3]
      intake.ts                createIntake(deps): Intake — captureFiles/captureUrl/captureText/captureBlob/captureDrop (owns ALL drop classification + precedence rules)
      file-importer.ts folder-importer.ts url-importer.ts text-importer.ts dedupe.ts (sha256, table-driven URL canonicalization)
    extraction/                [slice 3]
      registry.ts  text.ts  markdown.ts  pdf.ts (unpdf, in worker)  image.ts (dims, screenshot heuristic)  folder.ts (listing/sampling)
      url/ fetch.ts (fetchHtml(url, fetchImpl) + HEAD content-type sniff)  readable.ts (linkedom+readability+turndown, in worker)  metadata.ts  adapters/{github,youtube,twitter,generic}.ts
      worker-tasks.ts          registry of worker-side tasks owned by extraction (pdfText, htmlToReadable)
    previews/                  [slice 3]
      thumbnails.ts (qlmanage / nativeImage)  snapshot.ts (offscreen window, reusable)  assets.ts (favicon/og download)  color.ts (dominant color)
    ai/                        [slice 4]
      provider.ts (impl of ports.AIProvider types)  gmi-minimax.ts  mock-provider.ts  scripted-provider.ts (tests)
      structured.ts            JSON extraction (last ```json fence → balanced objects from the end → first zod pass), truncation detection, retry with errors, lenient tool-arg repair
      prompts/  schemas/       task prompts; zod schemas (Understanding, OrganizePlan, CommandFinish, …)
      embeddings/ transformers.ts (worker-side)  hash.ts  index.ts (provider pick, model seeding)  worker-tasks.ts
    retrieval/                 [slice 4]
      fts.ts  vectors.ts (matrix)  hybrid.ts (evidence, floors, weighted RRF, boosts)  query.ts (MATCH builder, cue parser, type cues, synonyms)  index.ts (createRetrieval)
    agent/                     [slice 4]
      tools/definitions.ts tools/handlers.ts (evidence preconditions, collection quality rules, suppression checks)  orchestrator.ts  runs.ts
      tasks/ understand.ts  organize.ts (single + batch)  consolidate.ts  folder.ts  command.ts (ask + multi-item + actions)  index.ts (createAgent)
    pipeline/                  [foundation; stage bodies by slices]
      queue.ts (job-repo ops)  scheduler.ts (lanes io=2, embed=1, ai=1; priority; backoff; crash reset; cancellation; batch gate)  state.ts  graph.ts (initialStages/nextStages per item type)
      stages/ index.ts (frozen STAGES list)  extract.ts thumbnail.ts snapshot.ts [slice 3]  embed.ts understand.ts index.ts relate.ts organize-batch.ts consolidate.ts [slice 4]
    worker/                    [foundation scaffold]
      index.ts (utilityProcess entry; merges extraction/worker-tasks + ai/embeddings/worker-tasks)  rpc.ts (request/response protocol)
    ipc/                       [foundation, complete]
      router.ts (createRouter({handle, isKnownSender, handlers}))  schemas.ts (zod, `satisfies z.ZodType<IpcRequest<C>>`)  events.ts (push to windows)  handlers/*.ts (all channels, against ports)
    desktop/                   [foundation]
      library-window.ts  shelf-window.ts  tray.ts  app-menu.ts  context-menu.ts  media-protocol.ts  shortcuts.ts  activation.ts  dom-fallback.ts (BrowserWindow-based HTML fetch fallback, used by extraction via PageFetcher port)
    lib/                       logger.ts (JSON lines, redaction)  config.ts (settings + secret store)  fs.ts  worker-client.ts  clock.ts

  preload/  index.ts (contextBridge: invoke/on/getPathForFile/platform)  api.ts (KeepAnythingApi type)

  renderer/src/
    main.tsx app.tsx (route by ?view=library|shelf; mounts fixed component slots)
    styles/ tokens.css (light+dark, the design contract)  global.css (document-style reset)  fonts.css
    state/  library.ts (items, filters, selection, focus)  collections.ts  runs.ts (agent runs keyed by runId, subscribed at boot)  ui.ts (route, modalStack, palette)  toasts.ts  settings.ts  jobs.ts
    lib/    ipc-client.ts (typed invoke/on + dev MockBridge when window.keepAnything is absent)  keyboard.ts (focus-zone scoped map)  format.ts  dnd.ts (internal MIME)
    components/
      shell/      Sidebar  Toolbar  StatusStack  DropOverlay  LocalStatusFooter
      library/    MasonryGrid (JS-positioned)  ItemCard + bodies (Image, Video, Url, Github, Pdf, Text, Folder, Note, File)  ItemRow  EmptyState  TrashHeader
      detail/     ItemDetail (hero, Understanding [editable], Related, Collections, Actions, footer)  NoteView  AgentActivity ("How this was organized")
      palette/    CommandPalette (cmdk; local hits first; Ask row rules)  AskResult (evidence header + sources)  RunProgress
      selection/  SelectionBar
      collections/ CollectionsGrid  CollectionCard  CollectionHeader  NewCollectionDialog  RenameInline
      settings/   SettingsView (key, model, import mode, theme, privacy, embeddings status, reprocess all)
      shelf/      ShelfView
      common/     Button  Kbd  Thumb  Dot  Menu triggers  Toast
```

**Contract files** (changed only by the foundation owner, in writing, one person): `src/shared/**`, `src/main/ports.ts`,
`src/main/ipc/**`, `src/main/pipeline/{queue,scheduler,state,graph}.ts`, `src/main/pipeline/stages/index.ts`,
`src/main/worker/**`, `src/main/index.ts`, `package.json`, `electron.vite.config.ts`, `electron-builder.yml`,
`src/renderer/src/styles/tokens.css`, `src/renderer/src/app.tsx`, `src/renderer/src/state/**`, `src/renderer/src/lib/ipc-client.ts`.
Slices replace bodies behind frozen exported names; they never add paths to contract files or run `pnpm add`.
Stubs: `throw new KaError('NOT_IMPLEMENTED', …)`.

Testability rule: no module under `core/ capture/ extraction/ retrieval/ agent/ pipeline/ storage/ ai/` imports
`electron` or reads `process.env`. Electron-touching code lives in `desktop/`, `previews/{thumbnails,snapshot}.ts`,
`lib/config.ts`, `storage/paths.ts`, `worker/index.ts` and is injected via `ports.ts` deps.

Conceptual layering: physical object → Item row → extracted text/metadata → understanding (+vision text,
retrieval hints) → embeddings/FTS → relationships → collections (manual | ai | dynamic).

---

## 2. Data model (`storage/migrations/001-init.sql`)

ISO-8601 UTC timestamps; UUID v4 ids. JSON columns hold JSON text.

```sql
items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,             -- 'file'|'folder'|'image'|'video'|'audio'|'pdf'|'text'|'markdown'|'url'|'note'|'unknown'
  subtype TEXT,                   -- url: article|github_repo|youtube|tweet|product|docs|paper|figma|social|generic
                                  -- image: screenshot|photo|design|generic ; file: document|spreadsheet|presentation|archive|code|data|other
  kind TEXT,                      -- Understanding.kind (shared/kinds.ts closed vocabulary), queryable
  title TEXT NOT NULL,
  original_path TEXT, managed_path TEXT,        -- managed_path relative to objects/
  url TEXT, canonical_url TEXT, domain TEXT,
  mime_type TEXT, size INTEGER, content_hash TEXT,
  width INTEGER, height INTEGER, duration_ms INTEGER, page_count INTEGER,
  created_at TEXT NOT NULL, captured_at TEXT NOT NULL, modified_at TEXT NOT NULL, last_kept_at TEXT NOT NULL,
  capture_batch_id TEXT,          -- items dropped together share a batch (drives batch organize)
  processing_status TEXT NOT NULL, processing_error TEXT,
  understanding TEXT, why_useful TEXT,
  topics TEXT NOT NULL DEFAULT '[]', entities TEXT NOT NULL DEFAULT '[]',
  vision_text TEXT,               -- visualDescription + visibleText from vision
  retrieval_hints TEXT NOT NULL DEFAULT '[]',
  suggested_actions TEXT NOT NULL DEFAULT '[]',   -- ids from shared/actions.ts
  ai_confidence REAL,
  metadata TEXT NOT NULL DEFAULT '{}',            -- og, favicon, repo stats, folder structure, exif, note sources, sourceUrl …
  extracted_text TEXT,            -- capped at CONSTANTS.maxExtractedChars
  excerpt TEXT,                   -- ≤280 chars for text cards
  thumbnail_path TEXT, snapshot_path TEXT, favicon_path TEXT, dominant_color TEXT,
  media_version INTEGER NOT NULL DEFAULT 1,       -- bumps when thumb/snapshot regenerate (cache busting)
  parent_item_id TEXT REFERENCES items(id) ON DELETE SET NULL,
  user_overrides TEXT NOT NULL DEFAULT '{}',      -- {"title":true,"understanding":true,...}
  is_missing INTEGER NOT NULL DEFAULT 0, missing_checked_at TEXT,
  deleted_at TEXT
);
items_fts USING fts5(item_id UNINDEXED, title, retrieval_hints, topics, entities, understanding, why_useful,
                     vision_text, meta_text, extracted_text, domain, kind,
                     tokenize='porter unicode61 remove_diacritics 2', prefix='2 3');
collections (id PK, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE /* normalized */, description TEXT, type 'manual'|'ai'|'dynamic',
             query TEXT /* dynamic: {text, filters, minCosine} */, created_by 'user'|'agent', color TEXT, pinned INTEGER DEFAULT 0,
             created_at, updated_at);
collection_items (collection_id, item_id, confidence REAL, reason TEXT, added_by 'user'|'agent'|'dynamic', agent_run_id TEXT, added_at, PK(collection_id,item_id));
relationships (id PK, source_item_id, target_item_id, type, description, confidence REAL, evidence TEXT /* JSON {itemId, quote} */,
               created_by 'user'|'agent'|'system', agent_run_id TEXT, created_at, UNIQUE(source_item_id,target_item_id,type));
  -- symmetric types (related_to, same_project, alternative_to, contradicts, duplicate_of) stored with source_id < target_id
embeddings (item_id, chunk_index INTEGER, role 'summary'|'body', content TEXT, vector BLOB, model TEXT, dims INTEGER, PK(item_id,chunk_index));
agent_runs (id PK, item_id NULL, batch_id NULL, task TEXT, status 'running'|'succeeded'|'failed'|'cancelled', model TEXT,
            started_at, completed_at, steps TEXT /* JSON AgentStep[] (truncated payloads, no reasoning) */, result TEXT JSON, error TEXT, usage TEXT JSON);
jobs (id PK, item_id NULL, batch_id NULL, stage TEXT, lane 'io'|'embed'|'ai', priority INTEGER DEFAULT 0,
      status 'queued'|'running'|'done'|'failed'|'cancelled', attempts INTEGER DEFAULT 0, run_after TEXT, last_error TEXT, created_at, updated_at);
  CREATE UNIQUE INDEX jobs_active ON jobs(item_id, stage) WHERE status IN ('queued','running') AND item_id IS NOT NULL;
audit_log (id PK, actor 'user'|'agent'|'system'|'dynamic', action TEXT, entity TEXT, entity_id TEXT, before TEXT JSON, after TEXT JSON,
           agent_run_id TEXT, created_at, undone_at TEXT);
suppressions (kind TEXT, key TEXT, created_at, PK(kind,key));
  -- 'relationship' key '<minId>:<maxId>' (any type) ; 'collection_member' keys '<collectionId>:<itemId>' AND 'name:<name_key>:<itemId>' ; 'dynamic_member' '<collectionId>:<itemId>'
schema_migrations (version INTEGER PK, applied_at);
```

**Atomic units** (all via `db.transaction`, unit-tested with a forced throw mid-unit): capture = item + initial jobs;
stage completion = StagePatch (item columns + `json_patch(metadata)`) + job done + next jobs; agent mutation = entity
row(s) + audit row (`create_collection` = collection + memberships + audit); undo = apply `before` + `undone_at` +
suppression; trash/restore/deleteForever = item + cancel jobs (+ FTS delete); embeddings replace = delete + insert;
FTS sync happens inside the item write transaction.

Generated notes are Items (`type='note'`, `managed_path` → `content/<id>.md`, `metadata.sources = [{itemId, role, why}]`)
with `created_from` relationships to sources. Notes skip understand/relate: embed + index only.

---

## 3. IPC contract

Requests via `ipcRenderer.invoke`; every response is `{ ok: true, data } | { ok: false, error: { code: IpcErrorCode, message } }`.
`IpcErrorCode = 'VALIDATION'|'NOT_FOUND'|'CONFLICT'|'NOT_IMPLEMENTED'|'AI_NOT_CONFIGURED'|'AI_UNAVAILABLE'|'OFFLINE'|'CANCELLED'|'INTERNAL'`.
Handlers throw `KaError`; router maps it, logs anything else as INTERNAL. Payloads validated by zod in `main/ipc/schemas.ts`.

```
items:list        { view: 'library'|'links'|'files'|'trash'|'collection', collectionId?, types?, sort?: 'captured'|'created'|'title', limit?, offset? } → ItemSummary[]
items:get         { id } → ItemDetail   // item + relationships[{…, direction:'out'|'in', label, other: ItemSummary}] + collections[{…, reason, addedBy, agentRunId}] + latestRuns: AgentRunSummary[] + children?: ItemSummary[]
items:update      { id, patch: { title?, understanding?, whyUseful? } } → ItemDetail        // sets user_overrides, re-indexes
items:trash / items:restore / items:deleteForever   { ids } → void
items:reprocess   { id, from?: Stage } → void        items:reprocessAll { from?: Stage } → { count }
items:openOriginal | items:revealInFinder | items:quickLook | items:openUrl   { id } → void
items:readContent { id } → { markdown?: string, text?: string }
capture:files     { paths: string[], mode?: 'copy'|'reference' } → CaptureResult
capture:url       { url } → CaptureResult          capture:text { text, title? } → CaptureResult
capture:blob      { name, mimeType, bytes: ArrayBuffer } → CaptureResult       // clipboard images, Files without a disk path
capture:drop      { files: string[], uriList?: string, text?: string, html?: string, source: 'library'|'shelf', collectionId? } → CaptureResult
                  // renderer sends the raw dataTransfer snapshot and does ZERO classification; intake owns precedence rules (§5)
collections:list  () → CollectionSummary[]  (count, 4 cover thumbnail urls, description, type)
collections:create { name, description? } → Collection      collections:createDynamic { name, description?, query: DynamicQuery } → Collection
collections:rename { id, name, description? }   collections:delete { id }   collections:addItems { id, itemIds }   collections:removeItem { id, itemId }
relationships:create { sourceId, targetId, type, description? }     relationships:remove { id }
search:quick      { query, limit? } → SearchHit[]           // FTS + vector fusion, no LLM, < 50 ms
agent:command     { question, itemIds?, template?: 'compare'|'common'|'summarize'|'brief'|'extract'|'custom' } → { runId }   // Ask + multi-item + ⌘K commands
agent:action      { itemId, actionId } → { runId }          // actionId ∈ ITEM_ACTIONS
agent:cancel      { runId } → void
agent:run         { id } → AgentRunDetail
agent:undo        { auditId } → void
agent:undoRun     { runId } → { undone: number }        // reverts every un-undone audit row of the run, newest first
agent:applyProposals { runId } → { applied: number; remaining: AgentProposal[] }   // applies staged proposals through the services (audit rows); proposals persist in agent_runs.result JSON
settings:get () → Settings (key masked)   settings:update (patch) → Settings   settings:testConnection () → { ok, model, latencyMs }
system:stats () → { items, connections, collections, processing, aiStatus: 'off'|'connected'|'offline'|'unconfigured' }
system:contextMenu { kind: 'item'|'items'|'collection'|'background', ids, collectionId? } → { action?: string }
system:openExternal { url }        system:chooseFiles () → { paths }        system:revealLibrary () → void   // shell.showItemInFolder of the library dir
jobs:status () → JobProgress[]

events (main → renderer; renderer subscribes once at boot into stores):
items:changed       { reason: 'created'|'updated'|'trashed'|'restored'|'deleted', ids, summaries?: ItemSummary[] }
jobs:progress       { itemId, processingStatus, stage, jobStatus: 'queued'|'running'|'done'|'failed'|'cancelled', attempts, message? }   // scheduler only
collections:changed { }
agent:run           { runId, task, status: 'running'|'succeeded'|'failed'|'cancelled', itemId?, batchId?, step?: AgentStep, result?: AgentResult, error?: IpcError, undoable?: boolean }
                    // emitted: on start (before invoke resolves), after every tool step, at the end
shelf:dropped       { result: CaptureResult }
settings:changed    { settings }
theme:changed       { theme: 'light'|'dark' }
```

Key shared types (full definitions in `shared/types.ts`):
- `ItemSummary` = card payload: id, type, subtype, kind, title, domain, url, thumbnailUrl, snapshotUrl, faviconUrl (ka-media URLs built only in main), dominantColor, width, height, size, mimeType, durationMs, pageCount, excerpt, capturedAt, createdAt, processingStatus, processingError, understanding (≤ `summaryUnderstandingMaxChars`), collectionIds, childCount, childThumbnailUrls (≤4), card?: { language, stars, description, owner }, isMissing, parentItemId.
- `CaptureResult = { items: { id, status: 'created'|'duplicate', existingId?, title }[] , batchId }`.
- `AgentStep = { n, tool, kind: 'search'|'read'|'inspect'|'compare'|'write'|'finish', label, itemIds?, status: 'ok'|'rejected', rejectReason?, durationMs }`: product-voice `label` produced by per-tool formatters in the orchestrator; never contains model reasoning.
- `AgentResult` discriminated by task: `{ task:'command', kind:'answer'|'note', answer?, noteId?, sources:[{itemId, role:'primary'|'supporting', why}], cues:{topics[], types[], timeframe?}, confidence, proposals?: AgentProposal[], appliedCount? } | { task:'understand', … } | { task:'organize', relationshipIds, collectionIds, summary } | { task:'consolidate', … }`.
- `SearchHit / Candidate = { id, title, type, subtype, kind, domain, capturedAt, capturedAgo, understanding (≤140), snippet?, evidence: { bm25Norm?, cosine?, matchedFields[] }, score }`.
- `DynamicQuery = { text, filters: SearchFilters, minCosine }`; `SearchFilters = { types?, subtypes?, kinds?, domains?, since?, until?, strict?: boolean }` (dates on `captured_at`).

Preload exposes `window.keepAnything = { invoke(channel, payload), on(event, listener) → unsubscribe, getPathForFile(file), platform }`.
Zero dependencies in preload (sandboxed).

---

## 4. Retrieval (slice 4)

Index content:
- **FTS** columns, weights `bm25(items_fts, 0, 8, 6, 4, 4, 3, 3, 3, 2, 1, 2, 2)` (title 8, retrieval_hints 6, topics/entities 4, understanding/why_useful/vision 3, meta 2, text 1, domain 2, kind 2). `meta_text` = flattened metadata (og description, repo description/language/topics, site name, filename).
- **Embeddings, two phases.** Phase 1 (`embed` stage, offline): body chunks ~900 chars (MiniLM truncates at 256 wordpieces), ≤24 chunks/item, `chunk_index ≥ 1`, `role='body'`; skipped for children of folders with > 50 files. Phase 2 (`index` stage, after understanding and after any indexed-field edit): the **memory document** = title + kind + domain + understanding + whyUseful + topics + entities + visionText + retrievalHints → `chunk_index 0`, `role='summary'`. Vector hits are max-pooled per item; summary weight 1.0, body 0.8. Item-to-item candidates use chunk 0 only. Always filter by `model`.
- Query building (`query.ts`). Never forward raw text to MATCH: tokenize on non-alphanumerics; extract cues (time phrases → soft window on `captured_at`; type cues via table: website/site/page→type url, pdf→pdf, repo/github→subtype github_repo, screenshot→subtype screenshot, app/mac app/tool→kinds [macos_app, cli_tool, saas_product], video/youtube→type video|subtype youtube; small synonym expansion app↔application, mac↔macos, repo↔repository, pic/photo↔image); strip stopwords/cue words; quote every token; AND first, fall back to OR when < N hits; `*` prefix on the last token for the instant path; own grammar for `"phrase"`, `type:`, `since:`.
- Fusion (`hybrid.ts`): weighted RRF (≤2 content tokens → FTS 1.0 / vector 0.4; else 1.0/1.0); cosine floor 0.30 for vector-only entries; top-tier boost on exact title/domain/entity match; time-cue plateau boost ×1.5 inside window decaying to ×1.0 over an equal margin; mild recency `×(1 + 0.25·e^(−ageDays/60))` only when no time cue; type cues = soft boosts unless `strict`. Hits carry component evidence. Notes excluded from default retrieval unless a note cue is present; folder children collapsed under the parent (≤3 shown, "in folder X").
- Dynamic collections: `query` stored as `DynamicQuery`; membership materialized into `collection_items` (`added_by='dynamic'`) on item READY/indexed events and on creation (rule: cosine(chunk0, queryVec) ≥ minCosine OR FTS match with filters); user pin/exclude via suppressions `dynamic_member`; query embedding cached.
- Evaluation harness: `pnpm run eval:retrieval` runs the brief's example queries against a fixture library (`tests/fixtures/corpus` + real MiniLM) and prints hit ranks; not part of `pnpm test`.

Dedupe (slice 3): files by sha256; URLs by table-driven canonicalization (strip utm_*/fbclid/ref/gclid, lowercase host, drop www./m./mobile., drop fragment, youtu.be→youtube.com/watch?v=, x.com→twitter.com, trailing slash, keep meaningful query keys). Duplicate capture creates no item: bumps `last_kept_at`, writes audit `kept_again`, returns `status:'duplicate'` → UI shows "Already kept · 3 weeks ago" and rings the existing card.

---

## 5. Capture, extraction, previews (slice 3)

`intake.captureDrop` precedence: (1) `uriList` non-empty and every file is `.webloc`/`.url` → discard files; (2) files present and every URL is an image/media URL → discard URLs, keep first as `metadata.sourceUrl`; (3) any path under `os.tmpdir()`, `/private/var/folders`, `TemporaryItems` → ALWAYS copy into objects/ regardless of import mode; (4) parse `text/uri-list` line by line (skip `#`, blanks), dedupe vs `text`; text that is exactly one http(s) URL → url item; remaining text → text item; `html` → `<a>` text / `<title>` as provisional title. Log `dataTransfer.types` from Safari/Chrome/Arc on day one and adjust.

Files: stat, mime (by extension + magic sniff for images/PDF), sha256 (worker for > 8 MB), copy-or-reference per settings (`copy` default), Item at `CAPTURED`, initial jobs from `graph.initialStages`. Folders: folder Item + children Items (`parent_item_id`), limits `maxFolderFiles 500`, depth 4, skip `node_modules .git dist build .cache __pycache__ Library`, sample ≤20 text files ≤30 KB for the folder task; children get lower job priority. URLs: HEAD sniff (`application/pdf` → download into objects/ and treat as pdf item; images → image item), canonicalize, url Item, jobs extract + snapshot.

Extractors return `{ text?, metadata, excerpt?, partial?, error? }`: text/markdown direct (headings into metadata); PDF via unpdf in worker (text + page_count; page-1 aspect for thumbnails); images: dimensions, `screenshot` heuristic (macOS `Screenshot ... at ...` / `CleanShot` names, PNG, display-like aspect, no camera EXIF); URL: fetch (15 s, browser UA) → if `< 400` readable chars use `PageFetcher` DOM fallback (offscreen window `document.documentElement.outerHTML`) → metadata (title, description, canonical, favicon, og:image, site name, page-type guess) → readable markdown; adapters: GitHub (REST repo + README, `card` stats), YouTube/Twitter (oEmbed), generic. Extraction results cached by canonical URL in `url-cache/`, so retries and reprocessing work offline. Unknown binaries: stored, `extracted_text` null, `partial:true`.

Previews: thumbnails to `thumbs/<id>.png` with real width/height persisted (masonry reserves space); URL snapshot to `snapshots/<id>.png` (plus optional full-page `<id>.full.jpg`); favicon/og downloaded into `objects/<id>/`; dominant color from the thumbnail. `media_version` bumps on regeneration.

---

## 6. AI, agent, pipeline (slice 4 + foundation)

### Provider
`gmi-minimax.ts`: fetch, 60 s timeout, 3 retries on 429/5xx (jittered backoff), `AbortSignal` support, usage logging
`{task, model, promptTokens, completionTokens, latencyMs}`. Sampling params (temperature/top_p) live in provider config.
Verify on day 1 whether M3 prefers vendor defaults (1.0/0.95) vs 0.2 by zod pass rate over 20 understand calls and pick.
`maxTokens ≥ 8k` for structured/agentic calls. Keep `reasoning_content` on assistant messages **inside a run's in-flight
transcript** (verify GMI accepts it on request; else strip); strip when persisting or sending to the renderer. Truncation
(`finish_reason==='length'` or unclosed `<think>`) → do not parse, retry once with 2× max_tokens (cap 16k). Prose with no
tool call → re-prompt once with `tool_choice:'required'`; last allowed step forces `finish`; empty content → retry.
`mock-provider.ts` = heuristic, deterministic (tests/e2e/no key); `scripted-provider.ts` = FIFO of canned responses (orchestrator tests).

### Tools (the only way the model changes state)
Read: `inspect_item`, `read_document(id, maxChars)`, `search_in_item(id, query, k)` (over embedding chunks), `inspect_folder`,
`search_library(query, filters)`, `semantic_search(query, k, filters)`, `list_items({since, types, limit≤50})`,
`topic_overview({since})`, `get_related_items`, `list_collections`, `inspect_collection`.
Write: `create_collection(name, description, itemIds, reasons)`, `add_to_collection(collectionId, itemId, confidence, reason)`,
`rename_collection(id, name, description, reason)` (refuses user-created), `create_relationship(sourceId, targetId, type, description, confidence, evidence?)`,
`update_item_understanding(id, patch)` (refuses user-overridden fields), `create_note(title, markdown, sources)`, `suggest_action(itemId, actionIds)`, `finish(result)`.
Handler rules: zod-validated args; unknown tool → rejected step; typed relationships other than `related_to` require the
target to be `inspected` or `read` in this run (else structured error telling the model what to do); optional `evidence.quote`
verified against the target's text; `create_collection` requires `list_collections` called this run and ≥1 member `read`,
name ≥ 2 words and not a single topic word, description ≥ 60 chars, per-member reason, similarity check vs existing
(token overlap / cosine on name+description > 0.85 → error suggesting add/rename); ≥ 3 members, OR 2 members sharing a
named entity with a `same_project` link ≥ 0.85; suppressed facts refused; symmetric relationships normalized;
`create_note` sources must all be in `read`, markdown must contain `[n]` markers mapping to sources. Every step (ok or
rejected) is recorded as an `AgentStep` (payload summaries ≤ 500 chars) and emitted as `agent:run`. Per-task tool subsets.

### Tasks
- **understand** (1 structured call): inputs = title, type/subtype, metadata, capped text (~12k chars), and for images /
  URL snapshots / design files the ≤800px thumbnail (+ og image if snapshot failed) as `image_url`. Output `Understanding
  { kind, title, summary, whyUseful, topics[], entities[], visualDescription?, visibleText?, retrievalHints[3-6], suggestedActions[], confidence }`
  with specificity examples in the prompt (bad: "discusses AI"; good: "engineering article comparing inference batching
  strategies, useful as a reference for reducing GPU serving cost"). Applied via `item-service.applyUnderstanding` (honours overrides).
- **organize** (single item, ≤5 steps) / **organize-batch** (one run per capture batch of ≥2 items, ≤10 steps): thin
  candidates `{id, title, type, kind, domain, capturedAgo, topics, understanding≤140, cosine, sharedTopics, sharedEntities, flags}`
  from union of chunk-0 cosine top-10, FTS OR-query from topics+entities+title top-10, deterministic signals (same domain /
  GitHub owner / parent folder / same hour); `collectionCandidates` via centroid cosine + 3 nearest members; user-confirmed
  context (user collections/relationships) as ground truth. Deterministic near-duplicate rule first: same type and
  cosine ≥ 0.92 or same canonical title+domain → `duplicate_of` 0.9 without an LLM call.
- **consolidate** (when the ai lane drains and ≥3 items were organized since last sweep): all items' one-liners+topics
  (pre-cluster by cosine above 200 items), tools incl. `rename_collection`; conservative, audited, reversible.
- **folder**: structure + samples + children one-liners → folder understanding; optional collection.
- **command** (Ask + multi-item + item actions, ≤12 steps): step 1 classify (memory-cue retrieval → search tools;
  library survey → `list_items`/`topic_overview`; multi-item template → read seeds); read ≤3–5 items; `finish({kind:'answer'|'note', …, sources[{itemId, role, why}], cues})`.
  Notes via `create_note`. No answer without sources unless none cleared the floor (`sources: []`, UI says "Couldn't find anything about that." + nearest hits).

### Pipeline
Statuses: `CAPTURED → EXTRACTING → EXTRACTED → EMBEDDING → UNDERSTANDING → RELATING → READY`; `PARTIAL` (stored, not fully
understood), `EXTRACTION_FAILED` (continues to understanding on metadata only → PARTIAL), `AI_FAILED` (retryable),
`WAITING_FOR_AI` (no key / offline: ai-lane jobs stay queued; resumes on settings change or connectivity). Transition table
`shared/status.ts:next(status, stage, outcome)`; user-facing `USER_STAGES = reading(EXTRACTING,EXTRACTED,EMBEDDING) →
understanding(UNDERSTANDING) → connecting(RELATING)`.

Stages `extract, thumbnail, snapshot (io) · embed, index (embed) · understand, relate, organize_batch, consolidate (ai)`.
`StageDefinition = { name, lane, timeoutMs, run(ctx): Promise<StagePatch> }`; `StagePatch = { item?: whitelisted columns,
metadataPatch?, outcome: 'ok'|'partial'|'failed', message?, error? }` applied by the scheduler in one transaction. Stages
never write `items` directly. Graph (`graph.ts`): url → [extract, snapshot] → (both done) [embed, understand] → understand
done → [index] → [relate]; image → [thumbnail] → [understand] → [index] → [relate]; pdf/text/markdown/file → [extract, thumbnail]
→ [embed, understand] → [index] → [relate]; folder → [extract] → [understand(folder)] → [index] → [relate]; note → [embed, index].
`understand` for url/image waits for snapshot/thumbnail (they always complete: 20 s timeout). Batch gate: items sharing
`capture_batch_id` (≥2) get one `organize_batch` job enqueued when all siblings are indexed or 90 s after the first; singles get
`relate`. Priority: understand > index > relate; children of folders lower. Lanes io=2, embed=1, ai=1. `attempts` increments
at claim; crash reset `running→queued` only if `attempts < max` else `failed 'crashed'`; backoff 30 s / 2 min / 10 min; `cancelled`
on trash/delete; scheduler re-checks `deleted_at` before applying a patch; stages are idempotent.

Token discipline: capped text, thin candidates, ≤800px images, per-run token ceiling (60k prompt) → forced finish, short system prompts.

---

## 7. Desktop shell & security (foundation)

`index.ts` order: `protocol.registerSchemesAsPrivileged([{scheme:'ka-media', privileges:{standard:true, secure:true, supportFetchAPI:true, stream:true}}])`
→ dev userData suffix → single-instance lock → `whenReady` → config (safeStorage) → db + migrate → services → app menu
(edit/window roles, ⌘, Settings, ⌘K) → library window → tray + shelf → ipc → scheduler start → worker lazy.
Regular app: **no** `LSUIElement`, **no** `dock.hide()`; `setActivationPolicy('regular')` while the library window is visible,
`'accessory'` after the user closes it (tray + shelf keep running); `activate`/`second-instance` show the window; hide-on-close;
`before-quit` flag preserved. Library window: `titleBarStyle:'hidden'`, `trafficLightPosition:{x:16,y:18}`, `backgroundColor`
= `--bg-0`, min 960×640, no vibrancy; top 52 px `-webkit-app-region: drag`. Shelf: `type:'panel'`, frameless, transparent,
`alwaysOnTop 'floating'`, visible on all workspaces incl. full-screen, non-activating, positioned via `positioning.ts`.
Theme: `nativeTheme` + Settings override → `data-theme` attribute + `theme:changed`; `<meta name="color-scheme" content="light dark">`.
Accent from `systemPreferences.getAccentColor()` (fallback warm amber) pushed as `--accent`, not implemented: the
renderer always uses the amber `accent` token.

Security: `contextIsolation`, `sandbox`, no `nodeIntegration`; CSP `default-src 'none'; script-src 'self'; style-src 'self'
'unsafe-inline'; img-src 'self' data: ka-media:; media-src ka-media:; font-src 'self'; connect-src 'none'`; per-window hardening
(library/shelf: deny window.open, navigation, webview, permissions); snapshot windows: own policy (deny window.open/webview,
`disableDialogs`, downloads blocked on their session, no preload, no will-navigate block) and their `webContents.id`s rejected
by the IPC router. `ka-media://local/<root>/<encoded path>?v=` resolves only under `<userData>/{objects,thumbs,snapshots,content}`
(`path.relative` traversal check, pure function unit-tested), supports `Range` (206) for video, `Cache-Control: immutable`.
Context menus: native `Menu.popup`; resolve from item click handlers, `setTimeout` fallback in the close callback.

---

## 8. UI (foundation B = shell + tokens + stores; slice 5 = components)

**Tokens (`tokens.css`, contract, light+dark from day one)**: dark surfaces `--bg-0 #141210` (main) `--bg-1 #1a1816` (sidebar)
`--bg-2 #221f1c` (rows/text cards) `--bg-3 #2a2622` (sheets/palette); text `--fg-1 #efe9e1`, `--fg-2 rgba(239,233,225,.64)`,
`--fg-3 rgba(239,233,225,.48)`; `--hairline rgba(255,255,255,.07)`; `--accent` runtime (fallback `#d9a35a`) used only for
selection/focus/drop ring; radii 6/10/14; type scale 11/12/13(base)/15/20/28, weights 400/500/600, `tabular-nums` for counts;
hero serif = bundled OFL **Instrument Serif** (regular + italic, `assets/fonts/`), 44px, only in the empty-library hero;
system sans elsewhere; card at rest = no border/shadow (the thumbnail is the card); sheet shadow `0 24px 64px rgba(0,0,0,.45)`;
motion 120/180/260 ms + reduced-motion rule. Styling = CSS Modules + tokens (no Tailwind/shadcn). Icons = Lucide 16 px 1.5 stroke.
Light values in the same file. Global reset is document-style (selectable text in detail/notes, scrollable panes).

**Shell**: Sidebar (traffic-light inset, "KeepAnything", Library / Links / Files / Collections / Trash; "Collections"
list with counts + "New Collection"; Settings; `LocalStatusFooter`: "Local only" / "Local · GMI connected" / "Local · offline — AI paused",
click → Settings › Privacy). Toolbar: search **button** ("Search anything… ⌘K", opens the palette; one search surface), grid/list
toggle, sort, filter. Content area: MasonryGrid or ItemRow list (default list in Links/Files? no: grid everywhere, list optional).

**MasonryGrid**: JS-positioned (`transform`), columns = floor((w − 2·pad)/(220 + 14)), heights reserved from width/height
or per-type ratios (url 16:10, pdf 1:1.3, file 1:1, folder 4:3, text auto) with `dominantColor` fill; FLIP transitions on
insert/reflow; `loading="lazy"`; `content-visibility:auto`. Roving tabindex, ↑↓←→ nearest-card navigation, Home/End,
Enter = detail, Space = Quick Look, Shift+arrow extends selection, ⌘A, Esc clears, ⌫ → Trash. Focus ring only on
`:focus-visible` (2px accent, 2px offset); selected = 2px inset accent ring + check badge when ≥2 selected.
Keyboard map scoped by focus zone (grid / input / sheet). Cards: per-type bodies (image, video thumb + play glyph + duration,
url snapshot/og + favicon + domain, github card, pdf page + "PDF · 2.4 MB", text excerpt card, folder 4-thumb collage + count,
note with source count, file tile), title + secondary line, hover "…" → native context menu, processing = 6 px dot + USER_STAGES
label (1.2 s opacity pulse, off under reduced motion). Internal drags use `application/x-keepanything-items`; `<img>` non-draggable;
drag image = stacked thumbs + count; sidebar rows show an accent ring on dragover; drop → `collections:addItems` + toast with Undo.

**States**: empty library = editorial hero "Keep anything. / *We'll figure out the rest.*" + drop hint + "Paste a link (⌘V)" (+ stat
card only when empty); empty collection "Nothing here yet. Drag things in or let it fill up."; Trash "Trash is empty." with
Restore / Delete forever / Empty Trash; no hits "Nothing matches "x"." + Ask row; Ask none "Couldn't find anything about that.";
AI unavailable → cards "Kept. Not understood yet.", detail "Connect GMI in Settings to understand this."; failures expose "Try again";
missing original → file tile "Original moved or deleted", Open/Reveal disabled; duplicate → "Already kept · 3 weeks ago" + ring.

**Detail** = in-pane view (sidebar stays) on `ui.modalStack` (`detail < dialog < palette`); Esc pops top; focus restored to the
originating card; background `inert`; ←/→ prev/next; breadcrumb = navigation origin. Hero = original (image / snapshot / PDF page /
rendered markdown / file tile). Right column: title (click-to-edit), domain/link, Understanding (click-to-edit; "Edited by you"
marker), Why useful, Related (relationship label chips with × on hover + evidence quote when present), Collections ("Because: …",
× on hover), Actions (quiet text list ≤4 from `ITEM_ACTIONS` defaults merged with `suggested_actions`; no pills, no sparkle icons),
"How this was organized" → `AgentActivity` (steps in product voice), footer (captured, path, Reveal in Finder, Open, Quick Look).

**Palette (⌘K, cmdk)**: empty → 5 recent items + 3 suggestions; typing → local hits first (grouped, thumbs); "Ask: …" row only
after hits and only when the query looks like natural language (≥4 words / question word / "?") or when there are zero hits;
Enter on Ask → `agent:command` → `RunProgress` (quiet list of completed steps from `agent:run`, static dots, referenced thumbs,
Esc cancels) → `AskResult` inside the palette (evidence header from structured data: "Looked at 7 recent items · Read 3 ·
Theme: inference provider cost"; answer; source cards captioned by `why`; "Save as note"). No history, no regenerate, no ratings.
Multi-item: `SelectionBar` "3 selected · Compare · What do these have in common? · Summarize · Turn into a brief · Add to collection · Trash"
→ `agent:command` with template + itemIds; on `note` result open the note (or toast "Created … · Show").

**StatusStack** (bottom-right): "Saved." is frame one of the same entry; >1 in flight collapses to "Keeping 7 items · 3 understood";
final line only from real results ("Found 4 related things · Added to Doan Labs" + Undo). `toasts` store: max 3, 6 s unless hovered,
actions Undo/Show/Retry, ⌘Z → newest undoable.

**Settings** (sheet): GMI key (masked, encrypted at rest, "Test connection"), model, import mode, theme, library location + Reveal,
privacy panel (what is stored locally vs sent to GMI and when), embeddings status (model present/downloading), Reprocess all, danger zone.

---

## 9. Testing

Unit (Vitest, system Node ≥ 24): migrations + repos (temp DB), transaction helper (forced throw), object-store, dedupe + URL
canonicalization fixtures, adapter detection, extractors on fixtures (text/md/pdf), image screenshot heuristic, JSON extraction +
truncation + schema retry, query builder (FTS syntax safety, cues, filters), hybrid fusion with fake embeddings, media URL
resolver traversal, pipeline `next()` table and scheduler (injected clock: crash reset, backoff, lanes, priority, cancellation,
batch gate), router (fake `handle`: validation, envelope, sender check), agent tool boundary with `scripted-provider`
(unknown tool, invalid args, suppressed re-add refused, evidence precondition, generic name refused, mutations audited),
mock-provider understand→organize end-to-end offline. E2E (Playwright `_electron`, `KEEPANYTHING_E2E=1 KEEPANYTHING_AI=mock`):
launch shows the library window; `capture:files` on a temp text file → card; detail opens; ⌘K finds it; trash works; packaged-app
smoke (`pnpm run package:mac`, launch, drop + embed). Layout work: `pnpm run screenshot`, which fills an empty profile with
`scripts/seed-library.mjs` placeholder content (generated notes, snippets, a folder and flat-colour PNGs) so the masonry always
has something to lay out.

---

## 10. Implementation order

1. **Contracts** (one agent): `shared/*`, `ports.ts`, `core/errors.ts`, `001-init.sql`, deps manifest + hoisted reinstall + lockfile,
   `engines.node ≥ 24`, `.nvmrc`, `electron-builder.yml` (asarUnpack, extraResources models, no universal), `scripts/fetch-models.mjs`, fonts.
2. **Foundation A — main** (one agent): storage, core, lib, worker scaffold, pipeline (scheduler/graph/state + stage stubs),
   ipc (router/schemas/all handlers), desktop (windows/tray/menu/protocol/activation/context menus), `index.ts`,
   unit tests, e2e smoke updated.
   **Foundation B — renderer** (in parallel): tokens/fonts/reset, stores, ipc-client (+ dev MockBridge with fixture data), App shell,
   Sidebar, Toolbar, MasonryGrid with generic cards, EmptyState, DropOverlay, StatusStack skeleton, ShelfView, Settings skeleton.
3. **Slices in parallel**: 3 capture+extraction+previews (+ stages extract/thumbnail/snapshot); 4 ai+retrieval+agent (+ stages
   embed/index/understand/relate/organize_batch/consolidate, search/agent handler bodies via ports); 5 UI components (cards,
   detail, palette, ask, selection, collections, trash, settings, toasts, keyboard).
4. **Integration**: real flows with the GMI key; day-1 measurements (latency, tokens, 429s, sampling); fixes.
5. **Review**: adversarial bug hunt → verify → fix. 6. **Polish**: screenshots vs mockup, motion, light mode, README/AGENTS, packaging.

---

## 11. Risks & measurements (fill in during integration)

| Risk | Mitigation |
| --- | --- |
| Global drag interception | Drag-watch sidecar (drag pasteboard change count); degrades to tray `drag-enter` + tray click + ⌘⇧K + window overlay + ⌘V when the binary is missing. |
| MiniMax ignores json_schema; thinking tokens | Extraction + zod + retry; truncation handling; tool calls verified; measure sampling params day 1. |
| Free-tier limits / latency | ai lane = 1, batch organize (one run per drop), step caps, token ceiling, persisted jobs, UI never blocks. |
| Sites block fetch / JS-rendered | DOM fallback via offscreen window; URL item always kept ("link is safe"); snapshot + vision cover landing pages. |
| MiniLM missing offline | Shipped model files; hash fallback (FTS-only search when active); re-embed job when model arrives. |
| Huge folders / PDFs | Limits, sampling, worker process, timeouts. |
| Missing originals | `is_missing` cache; graceful detail; "Locate…" later. |
| Duplicate imports | sha256 + canonical URL; "Already kept". |
| AI corrupting state | Services + audit + suppressions + user overrides; undo per audit row; notes skip understand/relate. |
| Main-thread freezes | Worker for CPU work; in-memory vector matrix; SQLite fast paths measured (FTS 2.5 ms @5k). |
| Packaging natives | asarUnpack; packaged smoke test before slices finish; arm64 only. |

---

## 12. Implementation notes

Recorded during integration and a live end-to-end run against the real model. The sections above are the
design; when they disagree with this list, this list describes what ships.

**Capture and extraction (slice 3)**

- **Folders are one item, not a tree.** `intake.captureFolder` creates a single `type='folder'` item with a shallow
  manifest in `metadata.folder` / `metadata.topLevel` (`scanFolder`, ≤ 60 top-level entries, `LIMITS.folderMaxFiles` /
  `folderMaxDepth`, skip list). No child items are created and `parent_item_id` is unused for folders; the `folder`
  extractor walks the tree again and samples text files for the `folder` understanding task. `ItemDetail.children`
  stays empty for folders today.
- **URL snapshots** are `snapshots/<id>.png` (viewport 1280×800, `capturePage`) plus an optional full-page
  `<id>.full.jpg` when it stays under 8 MB (no WebP encoder in `nativeImage`).
- **A missing original settles `PARTIAL`, not `EXTRACTION_FAILED`.** `runExtract` returns `outcome:'partial'` with
  `metadata.unreadable = 'Original file not found'` when a referenced file has no bytes; the item is kept ("stored, not
  understood") and the card shows the missing-original tile. `is_missing` is still refreshed lazily by the detail view.
- **A URL that turns out to be a PDF stays `type='url'`.** `keepPdfFromUrl` downloads the bytes into `objects/<id>/`,
  sets `mime_type='application/pdf'`, `subtype='paper'`, `metadata.urlKind='pdf'`, `metadata.downloadedFrom`, runs the
  PDF extractor and queues a `thumbnail` follow-up so the card shows page 1. "treat as pdf item" was not done: the
  item keeps its URL identity (dedupe by canonical URL, "Open link" action) and gains a managed copy.
- **Extracted bodies live in `content/<id>.md|txt`.** For every type except `text` / `markdown` / `note` (whose
  original *is* the body) the extract stage writes the full readable body there (`metadata.content` records the file);
  `items.extracted_text` holds the capped copy used by FTS. `items:readContent` returns `{ markdown } | { text }` from
  that file (or the original for text types) and is what the detail hero and `read_document` use.
- URL fetches are cached by canonical URL in `url-cache/` so retries and reprocessing work offline.

**Agent (slice 4)**

- **Item actions propose, then apply.** `agent:action` runs stage `ProposedAction`s (`add_to_collection`,
  `create_collection`, `relate`, `tag`, `rename`, `trash`) in run memory. They are applied automatically only when the
  run is an action run **and** `finish.confidence ≥ autoApply` (never `trash`); the rest are listed in the answer as
  "Proposed, not applied: …" and can be applied later with `agent:applyProposals { runId }` (audited like every other
  agent write). Ask (`agent:command`) never auto-applies.
- **Undo is per run as well as per audit row.** `agent:undoRun { runId }` reverts every not-yet-undone audit row of a
  run in reverse order (suppressions written); `agent:undo { auditId }` remains for single facts.
  `AgentRunSummary` carries `steps` and `undoable`; the terminal `agent:run` event carries `undoable?: boolean`; both
  drive the "Undo" affordance. Staged proposals are persisted in `agent_runs.result` (`AgentResult.proposals`,
  `appliedCount`) and applied later with `agent:applyProposals { runId } → { applied, remaining }`.
- Sources cited by `finish` are filtered to items the run actually saw (search results, inspected/read items, seed
  items — `validSources`); the rest are dropped with a debug log, so an answer can end up with fewer sources than
  the model claimed. `autoApplyConfidence` defaults to 0.8.
- No `reasoning_content` has ever been observed from GMI (79/79 probe calls, 0 in the live run); the strip-on-persist
  path is kept but nothing depends on it. See `docs/GMI_NOTES.md`.

**Embeddings**

- Unpackaged runs (`pnpm run dev`, E2E, scripts) only seed MiniLM from `<resources>/models`, which does not exist
  outside a packaged app, so they fall back to `local-hash` unless `build/models/Xenova/all-MiniLM-L6-v2` is copied
  into `<userData>/models`. Packaged builds seed from `extraResources` as designed.

**Shell**

- The system accent colour push (`systemPreferences.getAccentColor()` → `--ka-accent`) is not implemented; the
  renderer falls back to the amber `accent` token in both themes. `system:revealLibrary` (Settings › library location
  → Reveal) is main-only `shell.showItemInFolder` on the library directory.

**Test profiles**

- `KEEPANYTHING_E2E=1` uses the fixed path `<tmp>/keepanything-e2e` (not a per-run directory) and defaults the AI mode
  to `mock` unless `KEEPANYTHING_AI` is set. Playwright smoke, `scripts/screenshot.mjs` and `scripts/seed-library.mjs`
  share it; the screenshot script reuses whatever is there (`--reset` wipes it) and seeds placeholder content when the
  library is empty.
- macOS Electron emits `open-file` for path arguments on the command line, and `desktop/activation.ts` captures those
  paths, so any `electron <script>` launch (dev, E2E, Playwright's `-r loader.js`) imports its own `out/main/index.js`
  (and Playwright's loader) as `file` items. Packaged launches have no such arguments. The screenshot and seed
  scripts delete those items; the activation handler should ignore `open-file` paths that are also in `process.argv`.
