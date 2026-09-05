# 001 — Local-first storage on `node:sqlite`

**Status:** Accepted

## Context

The library holds a person's files, screenshots, receipts and half-remembered links. Anything that
leaves the machine is a liability, and a hackathon has no room for accounts, sync or a server.

## Decision

Everything lives on disk under `<userData>`: a single SQLite database opened with `node:sqlite`
`DatabaseSync` (SQLite 3.53, FTS5 + JSON1), plus `objects/`, `previews/` and `content/` directories.
Migrations are numbered `.sql` files in `src/main/storage/migrations/`. Originals are copied into
`objects/` or referenced in place, never moved or rewritten. Dev and packaged builds use separate
libraries (`<userData>/dev`) so a demo can never be corrupted by a dev run.

## Consequences

- Zero native dependencies, so `pnpm install` cannot break on a native rebuild, and unit tests run on
  plain Node ≥ 24 without Electron.
- No cloud sync, no multi-device, no accounts — accepted non-goals.
- `node:sqlite` transactions are synchronous: never `await` inside `transaction(fn)`.
