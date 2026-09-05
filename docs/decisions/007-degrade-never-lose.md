# 007 — A missing model parks work, it never fails a capture

**Status:** Accepted

## Context

The reasoning model is remote, rate-limited and optional (there may be no API key at all).

## Decision

Capture and indexing never depend on AI. When a stage raises `AI_NOT_CONFIGURED`, `AI_UNAVAILABLE` or
`OFFLINE`, the scheduler parks the job as `WAITING_FOR_AI` and pauses the `ai` lane rather than
failing the item; a timer re-opens the lane after a transient outage (an unconfigured key waits for
the user instead). A stage that raises `NOT_IMPLEMENTED` yields a partial result. Items settle as
`READY` or `PARTIAL` — "Kept. Partly understood." — and are always searchable, because FTS and
embeddings ran regardless.

## Consequences

- The app is fully usable with `KEEPANYTHING_AI=off`; the AI is an enrichment layer, not a dependency.
- Every user-facing status string has to be honest about what did and did not happen.
- The lane-reopen timer is the difference between "recovers on its own" and "recovers when you
  restart" — it is covered by a regression test.
