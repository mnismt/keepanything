# 004 — Local embeddings in a utilityProcess worker

**Status:** Accepted

## Context

GMI exposes no embeddings endpoint, and shipping text to a third party for vectors would break the
local-first promise. But running a transformer on the main thread stalls the UI, and the model files
may be missing in a fresh checkout.

## Decision

`Xenova/all-MiniLM-L6-v2` (q8, 384-d) runs through `@huggingface/transformers` in an Electron
`utilityProcess` worker. Model files ship in `build/models` (fetched by `pnpm run models:fetch`) and
are seeded into `<userData>/models`; packaged builds read `<resources>/models`, unpackaged runs read
the repo's `build/models`. If the model cannot load, a deterministic hashed TF-IDF vector
(`local-hash`, same 384 dimensions) takes over. Vectors record the model
that produced them; once the real model warms up, items embedded with `local-hash` are re-queued for
the `embed` stage automatically.

## Consequences

- Embedding never blocks the UI and a crashed worker cannot take down the app.
- Quality silently degrades rather than failing — hence the model tag on every vector and the
  automatic re-embed, without which a fallback run would poison the index permanently.
