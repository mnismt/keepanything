# KeepAnything website

TanStack Start (file-based routing, SSR) + StyleX on Vite 8. Tokens are the app's own
(`src/styles/tokens.stylex.ts` and `shared.ts` are symlinks into `src/renderer/src/styles/`).

Standalone project: run pnpm from this directory. The repo root forwards `pnpm run web:dev` only.

```bash
pnpm install
pnpm dev        # http://localhost:3000
pnpm build      # dist/client + dist/server
pnpm typecheck
```

Screenshots: every `<Shot>` in `src/routes/index.tsx` renders a labelled frame until it gets a `src`.
Put PNGs in `public/shots/` and pass `src="/shots/<name>.png"`. The hero is 16:9; the feature cards
carry their own ratio in the `FEATURES` array (4:3, 16:10 and 21:9). Each card's shot is clipped at
the card's bottom edge, so keep the important part of the picture near the top. The hero caption is
rendered by the site on a dark plate and stays readable over any image; leave it out of the PNG.

Routes are files under `src/routes/`; `src/routeTree.gen.ts` is generated, do not edit it.
Formatting comes from the repo root `biome.json` (`pnpm run format` at the root).
Deploy with the host's root directory set to `web/`. To target a specific host, add the adapter:
`pnpm dlx @tanstack/cli add <cloudflare|netlify|vercel>`.
