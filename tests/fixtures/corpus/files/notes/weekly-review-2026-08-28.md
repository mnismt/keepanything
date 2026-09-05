# Weekly review — week of 24 Aug 2026

## What happened

- Mon: read the PagedAttention paper properly instead of skimming the blog posts about it. The
  block table idea maps almost one-to-one onto virtual memory paging; copy-on-write for beam search
  is the clever bit.
- Tue: MiniMax Week kickoff. Registered KeepAnything for the Reasoning track. Got a GMI Cloud key.
- Wed: probed the GMI endpoint. No `reasoning_content` field comes back for M3; tool calls are
  clean JSON; one 429 in ~40 requests.
- Thu: wrote the eval queries for retrieval ("that pdf about attention", "the website with the
  globe animation"). Realised type cues matter more than I thought — "pdf" should hard-boost PDFs.
- Fri: MiniLM embeddings running inside the Electron utility process. 384 dims, ~9 ms per chunk.

## Decisions

1. Structured output = fenced/raw JSON extraction + zod + one retry. Never trust `json_schema`.
2. One organize run per drop batch instead of one per item.
3. Demo runs from a replay cache; live mode only if the venue Wi-Fi behaves.

## Next week

- Build the "Ask My Stuff" panel.
- Rehearse the 3-minute demo twice with a timer.
- Read the ReAct paper again; the "thought → action → observation" loop is basically our agent log.
