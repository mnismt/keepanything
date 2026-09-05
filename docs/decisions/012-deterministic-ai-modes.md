# 012 — Three AI modes so tests are deterministic

**Status:** Accepted (amended — `record` / `replay` removed)

## Context

Model calls are slow, non-deterministic, rate-limited and cost money. Tests cannot depend on them and
CI has no key.

## Decision

`KEEPANYTHING_AI` selects the provider: `gmi` (live), `mock` (a deterministic offline provider that
returns schema-valid answers, used by unit tests and E2E) and `off` (no AI at all — see 007). The key
itself lives only in the gitignored `.env` or the encrypted settings store, and the logger redacts
key-like values.

## Consequences

- The full app is testable end to end with no API key, and E2E runs are reproducible.
- There is no on-disk cache of model responses. Anything that needs to survive a rate limit or run
  offline has to be built for it explicitly; URL extraction already caches by canonical URL in
  `url-cache/`, which is what makes reprocessing work without the network.

## Amendment

This record originally specified two more modes, `record` (live, caching every request/response pair
to `<userData>/ai-cache/` keyed by the request) and `replay` (serve only from that cache). They existed
so a live demo could be rehearsed once and replayed offline. Both were removed along with the rest of
the demo scaffolding: `ai/cache-provider.ts`, `Paths.aiCacheDir` and the two `AiMode` members are gone.

The reasoning was that the cache keys are request-shaped, so any prompt edit silently invalidates a
recording — the feature is only safe to use after the prompts are final, which is when the
codebase should not be carrying it speculatively. Reintroduce it from git history when there is a
demo to rehearse.
