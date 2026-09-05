# 003 — Structured output by prompt contract, not `response_format`

**Status:** Accepted

## Context

Every reasoning step (understand, relate, organize, answer, command) needs a typed object back.
MiniMax-M3 on GMI accepts `response_format: json_schema` but does not enforce it — it returns prose,
fenced JSON, or JSON with commentary around it. It also emits `<think>` blocks, and a named
`tool_choice` is ignored (`'required'` works).

## Decision

The JSON contract lives in the prompt, appended byte-stably to the last user message so the server's
prefix cache still hits. The answer is extracted in three escalating steps — raw parse, last fenced
block, balanced-object scan — then validated with zod. A zod failure retries once with the formatted
error fed back to the model; `finish_reason: 'length'` is treated as unusable and retries once with
doubled `max_tokens` (8k → 16k cap). `<think>` blocks are stripped and `reasoning_content` is never
persisted. See `src/main/ai/structured.ts` and `docs/GMI_NOTES.md`.

## Consequences

- Works with any OpenAI-compatible endpoint, enforced schema or not.
- Two round-trips in the worst case; the retry budget is fixed at one per failure mode.
- Schemas must be forgiving where the model is reliably sloppy — e.g. a `timeframe` that arrives as a
  bare `"last 3 weeks"` string is coerced to `{ label }` rather than rejected.
