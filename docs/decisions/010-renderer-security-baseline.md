# 010 — Locked-down renderer plus a privileged `ka-media:` scheme

**Status:** Accepted

## Context

The app renders arbitrary user content — HTML snapshots, PDFs, images from the internet — and needs to
display local originals and previews without handing the renderer the filesystem via `file://`.

## Decision

Baseline: `contextIsolation: true`, `sandbox: true`, no `nodeIntegration`, a CSP
(`<meta>` in production, response headers in dev), `window.open` denied, navigation denied, permission
requests denied, and `system:openExternal` accepting `https:` only. Local media is served by a
registered privileged `ka-media:` scheme that resolves only inside the library directories and refuses
anything that escapes them.

## Consequences

- A hostile snapshot gets no filesystem, no network and no navigation.
- Media URLs must be minted through the shared helper; a raw path in an `<img src>` will not load.
- CSP changes must stay in sync between `electron.vite.config.ts` and `src/main/security.ts`.
