# 005 — Hybrid retrieval fused with weighted RRF

**Status:** Accepted

## Context

People search their own stuff two incompatible ways: exact ("the invoice from Anthropic") and vague
("that mac app I saved a few weeks ago"). BM25 is useless for the second; vectors are unreliable for
the first, and are unavailable at all until the embedding worker warms up.

## Decision

Two legs run per query and are fused with weighted reciprocal rank fusion, plus small boosts for
recency, kind and title hits: an FTS5 leg (porter unicode61, prefix 2/3, AND first, then an OR pass
scored at 0.6 when the AND pass is thin) and a vector leg against an in-memory normalized
`Float32Array` matrix (~23 MB at 15k items, sub-10 ms). Query vectors are cached per model. The
vector leg is skipped until the index is warm and the models match. "Ask My Stuff" is the same
retrieval with the agent layered on top — it never gets a private search path.

## Consequences

- Search works on first launch, before any AI has run.
- RRF needs no score calibration between two incomparable scales, at the cost of throwing away
  score magnitude.
- Retrieval quality is measurable: `pnpm run eval:retrieval` runs fixed queries against the test corpus.
