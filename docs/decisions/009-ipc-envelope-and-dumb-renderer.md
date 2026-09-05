# 009 — One envelope, zod at the boundary, a renderer that classifies nothing

**Status:** Accepted

## Context

The renderer is the untrusted half of an Electron app. It is also the half that receives drops, where
it is tempting to inspect the `dataTransfer` and decide "this is a link, that is a PDF".

## Decision

Channels, events and the `IpcEnvelope` are declared once in `src/shared/ipc.ts`. Every handler returns
that envelope; every payload is validated with zod in main; every sender is checked against the set of
known windows. The preload exposes exactly `invoke` / `on` / `getPathForFile` / `platform` on
`window.keepAnything`. On a drop the renderer sends a raw snapshot of the `dataTransfer` to
`capture:drop` and makes no decision about what it contains — all classification happens in main.

## Consequences

- One place to look for the wire format, and one place where untrusted input is validated.
- The renderer cannot be tricked into mislabelling a capture, because it never labels anything.
- Adding a channel means touching a shared contract file and both sides in the same change.
