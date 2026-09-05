# KeepAnything

Keep anything. We'll figure out the rest.

A local-first macOS library for files, folders, screenshots, PDFs, links and text. Originals are
preserved; a reasoning agent (MiniMax-M3 via GMI Cloud) understands each item and groups it into
semantic collections. Search and embeddings run on the Mac. Only what a specific AI task needs
leaves the machine.

Built for **MiniMax Week** (Reasoning track).

Electron 44 · React 19 · TypeScript 5.9 strict · `node:sqlite` (FTS5) · MiniLM embeddings in a
utility process · Vitest + Playwright · pnpm only.

- [`docs/PRODUCT_BRIEF.md`](docs/PRODUCT_BRIEF.md) — product
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — architecture and the contract between layers
- [`docs/GMI_NOTES.md`](docs/GMI_NOTES.md) — provider latency, tokens, quirks
- [`AGENTS.md`](AGENTS.md) — contributor conventions

## Setup

Requires macOS 13+ on Apple Silicon, Node 24 (`.nvmrc`) and pnpm 11 (`corepack enable`). No Xcode
tools needed.

```bash
pnpm install
pnpm run models:fetch   # MiniLM into build/models (gitignored); needed before packaging
pnpm run dev
```

## Commands

| Task | Command |
| --- | --- |
| Dev (HMR) | `pnpm run dev` |
| Type-check | `pnpm run typecheck` |
| Unit tests | `pnpm run test` |
| Electron smoke test | `pnpm run test:e2e` |
| Build to `out/` | `pnpm run build` |
| Package `.app` / `.dmg` (arm64) | `pnpm run package:mac` / `:dmg` |
| Seed a dev library with placeholder content | `pnpm run seed:library` |
| Screenshot the library window into `.artifacts/` | `pnpm run screenshot` |
| Retrieval evaluation harness | `pnpm run eval:retrieval` |

The packaged app lands in `release/mac-arm64/KeepAnything.app`.

`seed:library` drops generated placeholder items through the real preload bridge, so they run the
actual pipeline. It is a no-op unless the library is empty; `--reset` wipes the profile first and
`--force` seeds anyway.

## Configuration

Copy `.env.example` to `.env` (gitignored), or enter the key in Settings where it is encrypted with
`safeStorage`. Never commit a key.

| Variable | Meaning | Default |
| --- | --- | --- |
| `KEEPANYTHING_GMI_API_KEY` | GMI Cloud API key | empty (AI runs in `mock` mode) |
| `KEEPANYTHING_MODEL` | Reasoning model id | `MiniMaxAI/MiniMax-M3` |
| `KEEPANYTHING_AI` | `gmi`, `mock` or `off` | `gmi` with a key, else `mock` |
Also `KEEPANYTHING_E2E=1` (separate `userData`, test hooks) and `KEEPANYTHING_DEBUG=1`. Dev runs use
`<userData>/dev`, so dev and packaged builds never share a library.

## Opening the unsigned build

The app is unsigned (`identity: null`), so Gatekeeper complains on first launch. Either
right-click → **Open**, use System Settings → Privacy & Security → **Open Anyway**, or:

```bash
xattr -dr com.apple.quarantine "release/mac-arm64/KeepAnything.app"
```

## Known limitations

- macOS arm64 only. No cloud sync, accounts, telemetry or auto-update (by design).
- Without a GMI key the app runs in `mock` mode: items are kept and searchable, but summaries are
  heuristic and no collections form.
- GMI's free tier is shared: calls can take 20–60 s or return 429. Capture never blocks, but a batch
  of ~20 items can take 10+ minutes to settle.
- Global drag detection needs the `ka-drag-watch` sidecar (`pnpm run native`, requires the Xcode
  command line tools). Without it the shelf still opens from the menu-bar icon, ⌘⇧K and ⌘V.
- Folders are captured as one item with a manifest (huge folders are sampled). Pages behind logins or
  bot protection are kept as links with a snapshot only.
- `pnpm run dev` falls back to hashed embeddings unless MiniLM is copied into `<userData>/models`;
  packaged builds bundle it.
