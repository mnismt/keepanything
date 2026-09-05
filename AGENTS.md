# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this is

KeepAnything: a local-first macOS Electron app. "Keep anything. We'll figure out the rest." Users drop
files, folders, screenshots, PDFs, links and text into a library. Originals are preserved (copied into
`objects/` or referenced in place). A reasoning agent (MiniMax-M3 via GMI Cloud, OpenAI-compatible
chat completions with tool calling) understands each item, relates items to each other and creates
conservative semantic collections. Search is local (SQLite FTS5 + local MiniLM embeddings);
"Ask My Stuff" adds the agent on top of the same retrieval. Product spec: `docs/PRODUCT_BRIEF.md`.
Design and implementation contract: `docs/ARCHITECTURE.md` (read it before changing anything).

Non-goals: cloud sync, accounts, telemetry, auto-update, Windows/Linux, scraping behind logins.

## Stack

- Electron 44 (Node 24), electron-vite 5 (main / preload / renderer / worker bundles), Vite 7, React 19,
  TypeScript 5.9 strict with `noUncheckedIndexedAccess`.
- Storage: `node:sqlite` (`DatabaseSync`) with FTS5. Migrations in `src/main/storage/migrations/*.sql`.
- AI: GMI Cloud `POST /v1/chat/completions`, model `MiniMaxAI/MiniMax-M3`. Structured output is
  fenced-JSON extraction + zod + one retry; `response_format` is not relied on. Notes in `docs/GMI_NOTES.md`.
- Embeddings: `@huggingface/transformers` running `Xenova/all-MiniLM-L6-v2` (q8, 384-d) in a
  `utilityProcess` worker; hashed TF-IDF fallback when the model is missing.
- UI: StyleX (`@stylexjs/stylex` + `@stylexjs/unplugin` in the renderer Vite config, before the React
  plugin). Tokens are `defineVars` in `styles/*.stylex.ts`; the only plain CSS is `global.css` (reset,
  `@font-face`). zustand stores, cmdk palette, Lucide icons, Instrument Serif (bundled in
  `assets/fonts/`) for editorial headlines only.
- Tests: Vitest (unit), Playwright `_electron` (smoke). Packaging: electron-builder, unsigned arm64.
- Package manager: pnpm only. Never npm or yarn. Commit `pnpm-lock.yaml`.

## Commands

| Task | Command |
| --- | --- |
| Dev (library window opens; HMR for renderer, restart on main/preload) | `pnpm run dev` |
| Typecheck (node, web, e2e tsconfigs) | `pnpm run typecheck` |
| Unit tests | `pnpm run test` |
| Format + lint fix (also runs on staged files via the lint-staged pre-commit hook) | `pnpm run format` |
| Build to `out/` | `pnpm run build` |
| Electron smoke test (uses a throwaway `userData`) | `pnpm run test:e2e` |
| Fetch the embedding model into `build/models/` (gitignored) | `pnpm run models:fetch` |
| Compile the drag-watch sidecar into `build/native/` (gitignored; runs from `dev`/`build`) | `pnpm run native` |
| Retrieval eval over `tests/fixtures/corpus/eval-queries.json` | `pnpm run eval:retrieval` |
| Fill an empty dev library with placeholder content | `pnpm run seed:library` |
| Comment hygiene metrics (`--list` ranks docs that only restate the identifier) | `pnpm run audit:comments` |
| Package unsigned arm64 `.app` to `release/` | `pnpm run package:mac` |

Before finishing any change: `pnpm run typecheck && pnpm run test`. Run the screenshot script when
touching layout or CSS and look at the image.

Environment flags (see `.env.example`): `KEEPANYTHING_GMI_API_KEY`, `KEEPANYTHING_GMI_BASE_URL`,
`KEEPANYTHING_MODEL`, `KEEPANYTHING_AI=gmi|mock|off`, `KEEPANYTHING_E2E=1` (test profile + test hooks),
`KEEPANYTHING_DEBUG=1`. Dev and packaged builds never share a library: dev uses `<userData>/dev`.

## Secrets

The GMI API key lives only in the gitignored `.env` (or in the encrypted settings store written via
the Settings screen). Never commit it, print it, echo it from scripts, write it into docs or fixtures,
or paste it into prompts. The logger redacts key-like values.

## Layout

```
src/shared/     Contract, zero imports: types, ipc (channels/events/envelope), status table, actions,
                kinds, constants, media URLs, text helpers.
src/main/       Electron main. ports.ts = interfaces for every seam. core/ storage/ pipeline/ ipc/
                desktop/ lib/ worker/ are foundation; capture/ extraction/ previews/ (slice 3) and
                ai/ retrieval/ agent/ (slice 4) implement the ports.
src/preload/    contextBridge `window.keepAnything`: invoke / on / getPathForFile / platform.
src/renderer/   React app: App (library | shelf), state/ (zustand), lib/ (ipc-client + dev MockBridge),
                components/{shell,library,detail,palette,selection,collections,settings,shelf,common}
                (each component owns a folder named after it, e.g. library/item-card/).
native/         drag-watch/main.swift: the global drag sidecar (NDJSON on stdout), built by `pnpm run native`.
scripts/        fetch-models, build-native, screenshot, seed-library, eval-retrieval, probe/ (GMI + embedding probes).
tests/unit/     Vitest.   tests/e2e/  Playwright smoke.   tests/fixtures/corpus/  test corpus + eval queries.
assets/         fonts, tray template PNGs.   build/  app icon, icns, models (gitignored).   docs/  brief, architecture, notes.
```

## Conventions
- Use kebab-case for source filenames, including React components and hooks; keep conventional `index.ts(x)` barrels and required compound suffixes such as `*.stylex.ts`.
- Comment only what the signature cannot say: units, defaults, invariants, external quirks, and why the
  obvious approach was not taken. No doc comment that restates the identifier. No section-divider banners.
  A file header that only says what the file is: delete it. One that records an external constraint that
  explains why the file exists: keep it, in one line.

### Component folder layout

Every renderer component lives in its own folder named after the component, e.g.
`src/renderer/src/components/library/item-card/{index.tsx, styles.ts}`. The `index.tsx` is the
component and `styles.ts` holds the `stylex.create({...})` block (re-exported as `export const styles`).
Category folders (`library/`, `shell/`, `common/`, ...) keep their existing `index.ts` barrels
(`from './item-card'`, etc.): directory-as-module resolution makes the folder name a valid
specifier, so consumers never change. Cross-category imports go through the category barrel
(`from '../../common'`), not via deep paths (`from '../../common/button'`). Keyframe constants
and media-query sentinels declared in `styles.ts` are module-private: only `styles` is exported.
Exception: `shell/animated-icons/` is a single category without per-icon `styles.ts`; shared
animation tokens live in `shell/animated-icons/shared.ts` and prop types in `types.ts`, with each
icon's folder containing only `index.tsx` and the category `index.ts` re-exporting them.

- `src/shared/**`, `src/main/ports.ts`, `src/main/ipc/**`, the pipeline scheduler/graph/state and the
  renderer stores are contract files. Change them and update every consumer in the same change.
- Testability rule: nothing under `core/ capture/ extraction/ retrieval/ agent/ pipeline/ storage/ ai/`
  imports `electron` or reads `process.env`. Electron-touching code lives in `desktop/`, `previews/`,
  `lib/config.ts`, `storage/paths.ts`, `worker/index.ts` and is injected through `ports.ts`.
- Every IPC handler returns the `IpcEnvelope`; payloads are validated with zod in main; the sender is
  checked against known windows. The renderer never classifies drops: it sends the raw dataTransfer
  snapshot to `capture:drop`.
- Pipeline stages return a `StagePatch`; only the scheduler writes `items.status`. Stage bodies are
  idempotent. Status transitions come from `status.next()` in `src/shared/status.ts`.
- The agent mutates state only through services with audit rows; every agent action is undoable and
  user removals write suppressions so the agent does not redo them.
- Security baseline: `contextIsolation`, `sandbox`, no `nodeIntegration`, CSP,
  privileged `ka-media:` scheme serving only from the library directories, deny `window.open`,
  navigation and permission requests, `system:openExternal` accepts https only.
- Colours, radii, durations and shadows are StyleX `defineVars` tokens in `styles/tokens.stylex.ts`;
  components never hard-code them. StyleX rules: longhand properties only, pseudo-classes and media
  queries nested inside property values with a `default` key, no descendant selectors, no
  `::before`/`::after`, no `className`/`style` mixed with `stylex.props`. Dynamic values (masonry
  positions, progress) use function styles. Motion respects `prefers-reduced-motion`.
  No emoji, no gradients, no generic "AI app" styling.
- All npm packages except `@huggingface/transformers` are `devDependencies` (Electron bundles the rest).
- Do not run `pnpm add` casually. Version pins that matter: `@vitejs/plugin-react` 5.x (6.x needs
  Vite 8), TypeScript 5.9, `lucide-react` 1.40.

## Gotchas

- pnpm 11 ignores build scripts unless allowed in `pnpm-workspace.yaml`. If the Electron binary is
  missing, `pnpm run postinstall` runs `node_modules/electron/install.js`.
- `node:sqlite` transactions: never `await` inside `transaction(fn)`.
- MiniMax-M3 returns reasoning; strip `<think>` blocks and never persist `reasoning_content`.
  Treat `finish_reason: length` as unusable output, do not parse it.
- `Tray.getBounds()` can return garbage right after launch; use click-event bounds and validate.
- Orphaned Electron after a killed dev run: `pkill -f "keepanything/node_modules/.pnpm/electron"`.
- `qlmanage -t` returns non-zero for unsupported types; fall back to `nativeImage` or no thumbnail.
- StyleX emits everything in `@layer priorityN`. Unlayered CSS beats layered CSS regardless of specificity,
  so all plain CSS in `global.css` lives inside `@layer reset`, and `index.html` declares
  `<style>@layer reset;</style>` first to pin the layer order in dev (the StyleX runtime style tag lands
  before Vite's CSS there). Never add unlayered CSS or remove that tag. `.stylex.ts` files may only
  export `defineVars`/`defineConsts`; `createTheme` lives in `styles/themes.ts`.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:970c3bf2 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   bd dolt push
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->

<!-- BEGIN BEADS CODEX SETUP: generated by bd setup codex -->
## Beads Issue Tracker

Use Beads (`bd`) for durable task tracking in repositories that include it. Use the `beads` skill at `.agents/skills/beads/SKILL.md` (project install) or `~/.agents/skills/beads/SKILL.md` (global install) for Beads workflow guidance, then use the `bd` CLI for issue operations.

### Quick Reference

```bash
bd ready                # Find available work
bd show <id>            # View issue details
bd update <id> --claim  # Claim work
bd close <id>           # Complete work
bd prime                # Refresh Beads context
```

### Rules

- Use `bd` for all task tracking; do not create markdown TODO lists.
- Run `bd prime` when Beads context is missing or stale. Codex 0.129.0+ can load Beads context automatically through native hooks; use `/hooks` to inspect or toggle them.
- Keep persistent project memory in Beads via `bd remember`; do not create ad hoc memory files.

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.
<!-- END BEADS CODEX SETUP -->
