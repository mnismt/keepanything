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

Analytics: page views only, off unless the worker has a `POSTHOG_KEY`
(`npx wrangler secret put POSTHOG_KEY`). Put the same line in a local `.dev.vars` to exercise it in
dev. The root route reads it server-side and hands it to the browser in a `posthog-key` meta tag; no
autocapture, no session replay, no feature flags. `$pageview` and `$pageleave` are the only events;
the desktop app sends nothing and has no analytics.

`src/server.ts` wraps the TanStack Start handler with two things the platform will not do for us:
a 301 to `https://keepanything.app` for any other host or scheme, and a first-party proxy from
`/ingest/*` to PostHog so ad blockers cannot drop the events. `localhost` is exempt from the
redirect. After a deploy, these three should hold:

```bash
curl -sSo /dev/null -w '%{http_code} %{redirect_url}\n' http://keepanything.app/   # 301 https://keepanything.app/
curl -sS -X POST https://keepanything.app/ingest/i/v0/e/ -d '{}'                   # {"status":"Ok"}
curl -sS https://keepanything.app/ | grep -c 'meta name="posthog-key"'             # 1
```

Routes are files under `src/routes/`; `src/routeTree.gen.ts` is generated, do not edit it.
Formatting comes from the repo root `biome.json` (`pnpm run format` at the root).
Deploy with the host's root directory set to `web/`. To target a specific host, add the adapter:
`pnpm dlx @tanstack/cli add <cloudflare|netlify|vercel>`.
