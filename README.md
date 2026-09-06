# KeepAnything

Keep anything. We'll figure out the rest.

A local-first macOS library for files, folders, screenshots, PDFs, links and text. Originals are
preserved; a reasoning agent (MiniMax-M3 via GMI Cloud) understands each item and groups it into
semantic collections. Search and embeddings run on the Mac. Only what a specific AI task needs
leaves the machine.

Built for **MiniMax Week** (Reasoning track).

Electron 44 · React 19 · TypeScript 5.9 strict · `node:sqlite` (FTS5) · bge-small-en-v1.5 embeddings in
a utility process · Vitest + Playwright · pnpm only.

- [`docs/PRODUCT_BRIEF.md`](docs/PRODUCT_BRIEF.md) — product
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — architecture and the contract between layers
- [`docs/GMI_NOTES.md`](docs/GMI_NOTES.md) — provider latency, tokens, quirks
- [`AGENTS.md`](AGENTS.md) — contributor conventions

## Setup

Requires macOS 13+ on Apple Silicon, Node 24 (`.nvmrc`) and pnpm 11 (`corepack enable`). No Xcode
tools needed.

```bash
pnpm install
pnpm run models:fetch   # bge-small-en-v1.5 into build/models (gitignored); needed before packaging
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
| `KEEPANYTHING_GMI_API_KEY` | GMI Cloud API key | empty |
| `KEEPANYTHING_MODEL` | GMI reasoning model id | `MiniMaxAI/MiniMax-M3` |
| `KEEPANYTHING_OPENROUTER_API_KEY` | OpenRouter API key | empty |
| `KEEPANYTHING_OPENROUTER_MODEL` | OpenRouter model id | `minimax/minimax-m3:free` |
| `KEEPANYTHING_AI` | `gmi`, `openrouter`, `mock` or `off` | the provider with a key, else `off` |
Also `KEEPANYTHING_E2E=1` (separate `userData`, test hooks) and `KEEPANYTHING_DEBUG=1`. Dev runs use
`<userData>/dev`, so dev and packaged builds never share a library.

## Signing and notarizing

One-time setup on the build machine:

1. **Developer ID Application certificate.** Xcode → Settings → Accounts → the team → *Manage
   Certificates…* → **+** → **Developer ID Application**. This installs the private key in the login
   keychain. Verify: `security find-identity -v -p codesigning` lists
   `Developer ID Application: <Team> (TEAMID)`.
2. **App-specific password** for notarytool: appleid.apple.com → Sign-In and Security →
   *App-Specific Passwords*.
3. **Store the notary credentials in the keychain** so no secret ever lives in a file or in `.env`:

   ```bash
   xcrun notarytool store-credentials keepanything \
     --apple-id "you@example.com" --team-id TEAMID --password xxxx-xxxx-xxxx-xxxx
   ```

Then build:

```bash
APPLE_KEYCHAIN_PROFILE=keepanything pnpm run package:mac:dmg
```

electron-builder signs the bundle (including the `ka-drag-watch` sidecar and the unpacked
onnxruntime/sharp binaries) with hardened runtime, submits the `.app` to notarytool, staples the
ticket, then builds the DMG around the stapled app. No `xattr` needed on the result.

Verify:

```bash
codesign -dv --verbose=4 "release/mac-arm64/KeepAnything.app"   # Authority: Developer ID Application
xcrun stapler validate "release/mac-arm64/KeepAnything.app"
spctl -a -vvv -t install "release/mac-arm64/KeepAnything.app"   # accepted, source=Notarized Developer ID
```

Without `APPLE_KEYCHAIN_PROFILE` the build still signs but skips notarization (with a warning).

`pnpm run package:mac` overrides the identity to ad-hoc, so it needs no certificate — that build is
not notarized, and Gatekeeper wants a right-click → **Open** or
`xattr -dr com.apple.quarantine "release/mac-arm64/KeepAnything.app"` if it ever picks up a quarantine
flag.

Creating a Developer ID Application certificate requires the **Account Holder** role; an Admin with
*Certificates, Identifiers & Profiles* access still does not see it in Xcode's *Manage Certificates*
sheet. Either the Account Holder grants cloud-managed Developer ID access in App Store Connect →
Users and Access, or they create the certificate and export a `.p12` (with the private key) to import
here. A `.p12` can also be passed without installing it: `CSC_LINK=/path/cert.p12 CSC_KEY_PASSWORD=…`.

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
- `pnpm run dev` falls back to hashed embeddings unless bge-small-en-v1.5 is copied into
  `<userData>/models`; packaged builds bundle it.
