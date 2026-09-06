# 004 — Local embeddings in a utilityProcess worker

**Status:** Accepted

## Context

GMI exposes no embeddings endpoint, and shipping text to a third party for vectors would break the
local-first promise. But running a transformer on the main thread stalls the UI, and the model files
may be missing in a fresh checkout.

## Decision

`Xenova/bge-small-en-v1.5` (q8, 384-d, cls pooling) runs through `@huggingface/transformers` in an Electron
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

## Amended, 6 Sep 2026

Swapped `Xenova/all-MiniLM-L6-v2` for `Xenova/bge-small-en-v1.5` (BAAI, MIT; MTEB retrieval ~52 vs ~42).
Same 384 dimensions and the same five-file ONNX layout, so no schema or packaging change; the `model`
column in `embeddings` makes the swap a re-embed on first launch. Pooling is `cls` per the BAAI card
(`mean` was within 0.002 on paraphrase and ~0.04 worse on related sentences). The 512-wordpiece window
let body chunks grow from ~900 to ~1800 chars, so an item needs half the calls; each call is ~45 ms
versus ~8 ms for a 900-char MiniLM chunk (12 layers and twice the tokens), so a 24-chunk PDF is ~1.1 s.
Bge cosines cluster far higher than MiniLM's (unrelated pairs ~0.5, not ~0.1), so `cosineFloor` and
`nearDuplicateCosine` were re-measured on the eval corpus rather than carried over; the constants
record the numbers. The query instruction prefix was not adopted: v1.5 does not require it and the
eval did not need it. Two robustness fixes landed with the swap: `embedBody` no longer carries a
chunk-0 summary from another model or dims, and stale detection also flags rows whose `dims` column
disagrees with the provider, so a bad write is healed by the normal re-embed path.
