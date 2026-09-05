-- KeepAnything schema v1 (ARCHITECTURE §2). ISO-8601 UTC timestamps, UUID v4 ids, JSON columns hold JSON text.
-- Applied by storage/db.ts `migrate()`, which records the version in schema_migrations.
-- Requires SQLite with FTS5 and JSON1 (node:sqlite ships both).

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

-- Items: one row per kept object (files, folders, folder children, URLs, notes...)
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('file','folder','image','video','audio','pdf','text','markdown','url','note','unknown')),
  subtype TEXT,                                   -- url: article|github_repo|youtube|tweet|product|docs|paper|figma|social|generic
                                                  -- image: screenshot|photo|design|generic ; file: document|spreadsheet|presentation|archive|code|data|other
  kind TEXT,                                      -- Understanding.kind (shared/kinds.ts closed vocabulary), queryable
  title TEXT NOT NULL,
  original_path TEXT,                             -- absolute path of the referenced original
  managed_path TEXT,                              -- relative to objects/
  url TEXT,
  canonical_url TEXT,
  domain TEXT,
  mime_type TEXT,
  size INTEGER,
  content_hash TEXT,                              -- sha256 hex
  width INTEGER,
  height INTEGER,
  duration_ms INTEGER,
  page_count INTEGER,
  created_at TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  modified_at TEXT NOT NULL,
  last_kept_at TEXT NOT NULL,                     -- bumped on duplicate capture
  capture_batch_id TEXT,                          -- items dropped together share a batch (drives batch organize)
  processing_status TEXT NOT NULL CHECK (processing_status IN (
    'CAPTURED','EXTRACTING','EXTRACTED','EMBEDDING','UNDERSTANDING','RELATING','READY','PARTIAL',
    'EXTRACTION_FAILED','AI_FAILED','WAITING_FOR_AI')),
  processing_error TEXT,
  understanding TEXT,
  why_useful TEXT,
  topics TEXT NOT NULL DEFAULT '[]',              -- JSON string[]
  entities TEXT NOT NULL DEFAULT '[]',            -- JSON string[]
  vision_text TEXT,                               -- visualDescription + visibleText from vision
  retrieval_hints TEXT NOT NULL DEFAULT '[]',     -- JSON string[]
  ai_confidence REAL,
  metadata TEXT NOT NULL DEFAULT '{}',            -- JSON: og, favicon, repo stats, folder structure, exif, note sources, sourceUrl...
  extracted_text TEXT,                            -- capped at LIMITS.maxExtractedChars
  excerpt TEXT,                                   -- ≤ LIMITS.excerptChars, shown on text cards
  thumbnail_path TEXT,                            -- relative to thumbs/
  snapshot_path TEXT,                             -- relative to snapshots/
  favicon_path TEXT,                              -- relative to objects/
  dominant_color TEXT,
  media_version INTEGER NOT NULL DEFAULT 1,       -- bumps when thumb/snapshot regenerate (cache busting)
  parent_item_id TEXT REFERENCES items(id) ON DELETE SET NULL,
  user_overrides TEXT NOT NULL DEFAULT '{}',      -- JSON {"title":true,"understanding":true,...}
  is_missing INTEGER NOT NULL DEFAULT 0,
  missing_checked_at TEXT,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS items_deleted_captured ON items(deleted_at, captured_at);
CREATE INDEX IF NOT EXISTS items_processing_status ON items(processing_status);
CREATE INDEX IF NOT EXISTS items_canonical_url ON items(canonical_url);
CREATE INDEX IF NOT EXISTS items_content_hash ON items(content_hash);
CREATE INDEX IF NOT EXISTS items_parent ON items(parent_item_id);
CREATE INDEX IF NOT EXISTS items_capture_batch ON items(capture_batch_id);
CREATE INDEX IF NOT EXISTS items_type ON items(type);

-- Full-text index. Content-storing table synced explicitly by the item repository
-- (DELETE + INSERT inside the item write transaction). Column order matters for bm25() weights:
-- bm25(items_fts, 0, 8, 6, 4, 4, 3, 3, 3, 2, 1, 2, 2).
CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
  item_id UNINDEXED,
  title,
  retrieval_hints,
  topics,
  entities,
  understanding,
  why_useful,
  vision_text,
  meta_text,
  extracted_text,
  domain,
  kind,
  tokenize='porter unicode61 remove_diacritics 2',
  prefix='2 3'
);

-- Collections (manual | ai | dynamic) and membership
CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,                  -- normalizeName(name)
  description TEXT,
  type TEXT NOT NULL CHECK (type IN ('manual','ai','dynamic')),
  query TEXT,                                     -- dynamic: JSON DynamicQuery {text, filters, minCosine}
  created_by TEXT NOT NULL CHECK (created_by IN ('user','agent')),
  color TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS collection_items (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  confidence REAL,
  reason TEXT,
  added_by TEXT NOT NULL CHECK (added_by IN ('user','agent','dynamic')),
  agent_run_id TEXT,
  added_at TEXT NOT NULL,
  PRIMARY KEY (collection_id, item_id)
);

CREATE INDEX IF NOT EXISTS collection_items_item ON collection_items(item_id);

-- Relationship graph. Symmetric types (related_to, same_project, alternative_to, contradicts,
-- duplicate_of) are stored once with source_item_id < target_item_id (shared/kinds.ts normalizePair).
CREATE TABLE IF NOT EXISTS relationships (
  id TEXT PRIMARY KEY,
  source_item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  target_item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('related_to','inspired_by','same_project','references','alternative_to',
                                     'continuation_of','contradicts','duplicate_of','created_from','belongs_to')),
  description TEXT,
  confidence REAL,
  evidence TEXT,                                  -- JSON {itemId, quote}
  created_by TEXT NOT NULL CHECK (created_by IN ('user','agent','system')),
  agent_run_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (source_item_id, target_item_id, type)
);

CREATE INDEX IF NOT EXISTS relationships_source ON relationships(source_item_id);
CREATE INDEX IF NOT EXISTS relationships_target ON relationships(target_item_id);

-- Embeddings: chunk 0 = memory document ('summary'), chunks ≥ 1 = body text ('body').
-- vector = little-endian Float32Array bytes, L2-normalized. Always filter by model.
CREATE TABLE IF NOT EXISTS embeddings (
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('summary','body')),
  content TEXT NOT NULL,
  vector BLOB NOT NULL,
  model TEXT NOT NULL,
  dims INTEGER NOT NULL,
  PRIMARY KEY (item_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS embeddings_model ON embeddings(model);

-- Agent runs: transcript without model reasoning (steps are AgentStep[] with truncated payloads).
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  item_id TEXT REFERENCES items(id) ON DELETE SET NULL,
  batch_id TEXT,
  task TEXT NOT NULL CHECK (task IN ('understand','organize','organize_batch','consolidate','folder','command')),
  status TEXT NOT NULL CHECK (status IN ('running','succeeded','failed','cancelled')),
  model TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  steps TEXT NOT NULL DEFAULT '[]',               -- JSON AgentStep[]
  result TEXT,                                    -- JSON AgentResult
  error TEXT,
  usage TEXT                                      -- JSON AgentUsage
);

CREATE INDEX IF NOT EXISTS agent_runs_item ON agent_runs(item_id, started_at);
CREATE INDEX IF NOT EXISTS agent_runs_batch ON agent_runs(batch_id);

-- Jobs: persisted pipeline queue. One active (queued|running) job per item and stage.
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  item_id TEXT REFERENCES items(id) ON DELETE CASCADE,
  batch_id TEXT,
  stage TEXT NOT NULL CHECK (stage IN ('extract','thumbnail','snapshot','embed','index','understand','relate',
                                       'organize_batch','consolidate')),
  lane TEXT NOT NULL CHECK (lane IN ('io','embed','ai')),
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('queued','running','done','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  run_after TEXT,                                 -- do not claim before this timestamp (backoff / batch gate)
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS jobs_active ON jobs(item_id, stage)
  WHERE status IN ('queued','running') AND item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS jobs_claim ON jobs(status, lane, priority, run_after);
CREATE INDEX IF NOT EXISTS jobs_item ON jobs(item_id);
CREATE INDEX IF NOT EXISTS jobs_batch ON jobs(batch_id);

-- Audit log: every mutation by user/agent/system/dynamic; undo applies `before`.
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL CHECK (actor IN ('user','agent','system','dynamic')),
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before TEXT,                                    -- JSON
  after TEXT,                                     -- JSON
  agent_run_id TEXT,
  created_at TEXT NOT NULL,
  undone_at TEXT
);

CREATE INDEX IF NOT EXISTS audit_log_entity ON audit_log(entity, entity_id);
CREATE INDEX IF NOT EXISTS audit_log_run ON audit_log(agent_run_id);
CREATE INDEX IF NOT EXISTS audit_log_created ON audit_log(created_at);

-- Suppressions: facts the agent must never re-create after a user removed them.
--   'relationship'      key '<minId>:<maxId>' (any type)
--   'collection_member' keys '<collectionId>:<itemId>' AND 'name:<name_key>:<itemId>'
--   'dynamic_member'    key '<collectionId>:<itemId>'
CREATE TABLE IF NOT EXISTS suppressions (
  kind TEXT NOT NULL CHECK (kind IN ('relationship','collection_member','dynamic_member')),
  key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (kind, key)
);
