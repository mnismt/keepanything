# 011 — StyleX, with the reset layer pinned

**Status:** Accepted

## Context

The UI is meant to look designed rather than assembled: a dark-first editorial masonry with a small
token set. That needs enforced consistency, atomic output and no runtime cost — and it has to survive
a bundler that injects CSS in a different order in dev than in prod.

## Decision

StyleX via `@stylexjs/unplugin` (`useCSSLayers: true`, `devMode: 'full'`), registered *before* the
React plugin so Fast Refresh survives. Colours, radii, durations and shadows are `defineVars` tokens
in `styles/tokens.stylex.ts`; components never hard-code them. `.stylex.ts` files may only export
`defineVars`/`defineConsts` — `createTheme` lives in `styles/themes.ts`. The only plain CSS is
`global.css` (reset and `@font-face`), and it lives inside `@layer reset`, with
`<style>@layer reset;</style>` as the first thing in `index.html` to pin the layer order in dev.

## Consequences

- Unlayered CSS beats layered CSS regardless of specificity, so that one `<style>` tag is load-bearing:
  remove it and dev styling inverts against production. Never add unlayered CSS.
- StyleX constraints: longhand properties only, no descendant selectors, no `::before`/`::after`,
  pseudo-classes nested inside property values with a `default` key. Dynamic values use function styles.
- Design drift shows up as a hard-coded hex in review, which is easy to catch.
