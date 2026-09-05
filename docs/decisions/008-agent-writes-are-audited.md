# 008 — The agent mutates state only through audited services

**Status:** Accepted

## Context

An agent that reorganizes your library without a paper trail is a threat, not a feature — especially
one that recreates the collection you just deleted.

## Decision

The agent has no direct database access. It calls services (`collection-service`,
`relationship-service`) that write an `audit_log` row for every change, tagged with the actor
(`user` | `system`) and the agent run. Every agent action is undoable. When a user removes something
the agent proposed, the removal writes a *suppression* row, and the organize stage reads suppressions
before proposing, so the agent will not redo it. Collections are proposed conservatively.

## Consequences

- Every automatic change is inspectable, attributable and reversible.
- Suppressions are permanent, small and cheap to consult; the alternative — the agent re-proposing —
  destroys trust in one demo.
- Any new agent capability must go through a service before it can touch state.
