# 006 — Idempotent stages, one writer of status

**Status:** Accepted

## Context

Capture fans out into slow, heterogeneous work: hashing and copying, thumbnails, extraction,
embedding, and several model calls. These compete for different resources, they fail
independently, and the user watches the result live.

## Decision

Work is a graph of stages over jobs, run by a scheduler with per-resource lanes (`io: 2`, `embed: 1`,
`ai: 1`), priority, backoff, cancellation and a batch gate. A stage returns a `StagePatch` describing
what it learned; it never writes `items.status` itself. The scheduler applies the patch and computes
the next status from the table in `src/shared/status.ts`. Stage bodies are idempotent, so any stage
can be re-run for any item at any time (`items.reprocess(id, stage)`).

## Consequences

- Status is derivable and testable in isolation; there is exactly one place a bad transition can come from.
- Re-running one stage is a first-class operation, which is what makes the re-embed in 004 and the
  retry paths in 007 possible.
- Stage authors must resist writing status directly; this is enforced by review, not by the type system.
