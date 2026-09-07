<h1><img src="build/icon.png" width="40" align="top" alt=""> KeepAnything</h1>

Keep anything. We'll figure out the rest.

![KeepAnything library window](web/public/shots/hero.png)

A local-first macOS library for files, folders, screenshots, PDFs, links and text. Originals are
preserved. A reasoning agent (MiniMax-M3 via GMI Cloud) understands each item and groups related
items into collections. Search and embeddings run on the Mac; only what a specific AI task needs
leaves the machine.

Built for **MiniMax Week** (Reasoning track). Electron 44 · React 19 · TypeScript · `node:sqlite` FTS5 ·
bge-small-en-v1.5 embeddings.

## Install

Download the latest `.dmg` from [Releases](https://github.com/mnismt/keepanything/releases/latest)
(`-arm64` for Apple Silicon, `-x64` for Intel)
and drag `KeepAnything.app` into `/Applications`. The build is not notarized, so if macOS reports the
app as "damaged", clear the quarantine flag once:

```bash
xattr -dr com.apple.quarantine /Applications/KeepAnything.app
```

Requires macOS 13+ (Apple Silicon or Intel). Add a GMI Cloud (or OpenRouter) API key in Settings; without
one, items are still kept and searchable but summaries are heuristic and no collections form.

## Develop

Node 24 (`.nvmrc`) and pnpm 11 (`corepack enable`).

```bash
pnpm install
pnpm run models:fetch   # embedding model into build/models; needed before packaging
pnpm run dev
```

| Task | Command |
| --- | --- |
| Type-check + unit tests | `pnpm run typecheck && pnpm run test` |
| Electron smoke test | `pnpm run test:e2e` |
| Unsigned / signed `.dmg` (arm64 + x64) | `pnpm run package:mac` / `pnpm run package:mac:dmg` |
| Seed an empty dev library | `pnpm run seed:library` |

Keys can also go in a gitignored `.env` (see `.env.example`): `KEEPANYTHING_GMI_API_KEY`,
`KEEPANYTHING_OPENROUTER_API_KEY`, and `KEEPANYTHING_AI=gmi|openrouter|mock|off`. Dev and packaged
builds never share a library.

More: [product brief](docs/PRODUCT_BRIEF.md) · [architecture](docs/ARCHITECTURE.md) ·
[GMI notes](docs/GMI_NOTES.md) · [contributor conventions](AGENTS.md)
