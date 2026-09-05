# Decision records

One file per decision. Numbered, append-only: to change a
decision, add a new record and mark the old one superseded. Keep each under a page.

`docs/ARCHITECTURE.md` says how the system is built; these say why it is built that way.

| # | Decision | Status |
| --- | --- | --- |
| [001](001-local-first-sqlite.md) | Local-first storage on `node:sqlite`, no server, no sync | Accepted |
| [002](002-ports-and-injection.md) | Every external seam behind a port in `ports.ts` | Accepted |
| [003](003-structured-output-by-contract.md) | Structured model output by prompt contract + zod, not `response_format` | Accepted |
| [004](004-local-embeddings-worker.md) | Local embeddings in a `utilityProcess` worker, with a hashed fallback | Accepted |
| [005](005-hybrid-retrieval-rrf.md) | Hybrid retrieval: FTS5 + in-memory vectors fused with weighted RRF | Accepted |
| [006](006-pipeline-lanes-and-patches.md) | Pipeline of idempotent stages; only the scheduler writes `items.status` | Accepted |
| [007](007-degrade-never-lose.md) | An unavailable model parks work, it never fails a capture | Accepted |
| [008](008-agent-writes-are-audited.md) | The agent mutates state only through audited, undoable services | Accepted |
| [009](009-ipc-envelope-and-dumb-renderer.md) | One IPC envelope, zod at the boundary, the renderer classifies nothing | Accepted |
| [010](010-renderer-security-baseline.md) | Locked-down renderer plus a privileged `ka-media:` scheme | Accepted |
| [011](011-stylex-and-layers.md) | StyleX with CSS layers and a pinned `@layer reset` | Accepted |
| [012](012-deterministic-ai-modes.md) | Three AI modes (`gmi`/`mock`/`off`) so tests are deterministic | Accepted |
| [013](013-bundle-everything-devdependencies.md) | Every package is a devDependency except `@huggingface/transformers` | Accepted |
