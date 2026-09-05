# 002 — Every external seam behind a port

**Status:** Accepted

## Context

Three layers were built in parallel by different agents. Anything that imports `electron` or reads
`process.env` can only be exercised by booting the whole app, which makes it untestable and makes
parallel work collide.

## Decision

`src/main/ports.ts` declares an interface for every seam: `Logger`, `Clock`, `Paths`, `SecretStore`,
`EventBus`, `Intake`, `Retrieval`, `AgentService`, `AIProvider`, `EmbeddingProvider`, `Thumbnailer`,
`Snapshotter`. Nothing under `core/ capture/ extraction/ retrieval/ agent/ pipeline/ storage/ ai/`
imports `electron` or reads `process.env`; the Electron-touching implementations live in `desktop/`,
`previews/`, `lib/config.ts`, `storage/paths.ts` and `worker/index.ts` and are injected at startup
from `src/main/index.ts`.

## Consequences

- 400+ unit tests run in Vitest against fakes, in milliseconds, with no Electron.
- Ports are contract files: widening one means updating every implementation in the same change.
  (The preview ports were widened once mid-build so stages stopped casting.)
- One extra indirection between a stage and the thing it calls.
