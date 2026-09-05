---
name: effect-ts
description: Working with the Effect TypeScript library — installing it in a repository, writing or reviewing Effect code (services, layers, Schema, error handling, testing), and migrating a codebase from Effect v3 to v4. Triggers on 'Effect', 'effect-ts', '@effect/*', 'Effect.gen', 'Effect.fn', 'Context.Service', 'Schema.TaggedError', 'Layer', or an `effect` dependency in package.json.
source: https://github.com/Effect-TS/skills (skills/effect-ts + skills/effect-v3-to-v4, merged)
---

# Effect TypeScript

Effect v4 is pre-1.0 and its APIs are still moving. **Never write Effect code from memory, from
blog posts, or from a hand-written pattern catalogue** — including this file. The authoritative
guide ships inside the installed package and is versioned with it.

## The one rule: read the shipped guide first

Before writing any Effect code, read `node_modules/effect/AGENTS.md` **completely**, and follow
the links in it as needed. It is ~400 lines and covers services, Schema and domain modelling,
error handling, scopes and resources, running programs, PubSub, Stream, `ManagedRuntime`,
batching, Schedule, DateTime, observability, testing, `Predicate`, SQL, HttpClient, HttpApi,
child processes, CLI, the AI modules, and cluster. Each section links to runnable examples under
`node_modules/effect/ai-docs/src/**`.

For anything it does not cover, search the shipped source: `node_modules/effect/src/`
(452 modules, including `unstable/`). Confirm a real signature there before writing against it.

Do not consult a separate clone of the Effect repo for day-to-day coding. The shipped copy matches
the version actually installed; a clone does not.

## Why this file stays thin

Effect v4 renamed core APIs during the RC series, so a copied pattern catalogue rots fast and
then teaches APIs that do not exist. Verified against published `effect@4.0.0-rc.112`:

| Sometimes seen in older guides | Actually in v4 |
| --- | --- |
| `ServiceMap.Service` (no `ServiceMap` module exists) | `Context.Service` |
| `Schema.TaggedErrorClass("Tag")("Tag", {…})` (does not exist) | `Schema.TaggedError<E>()("Tag", {…})` |
| `Effect.catchAll` | `Effect.catch` |
| `Effect-TS/effect-smol` as the v4 repo | archived; canonical repo is `Effect-TS/effect` |

If a guide and `node_modules/effect/` disagree, the installed package wins. Prefer `Effect.gen`
plus `Effect.fn("name")` for composition, and note that `Effect.fn` takes its combinators as
extra arguments — do not `.pipe` an `Effect.fn`.

## Step 1: Install

Use the repository's package manager (this repo is **pnpm** only):

```sh
pnpm add effect@rc
```

In a monorepo, also install it as a dev dependency at the root so agents can reach
`node_modules/effect/src` and `node_modules/effect/AGENTS.md` from the workspace root:

```sh
pnpm add -D effect@rc
```

Version notes:

- All `effect` / `@effect/*` packages must share one version. In v4 they are released together.
- `effect@rc` ships `AGENTS.md`, `src/` and `ai-docs/`. Older `4.0.0-beta.*` releases **do not
  ship `AGENTS.md`** — if it is missing, the install is on a stale beta; upgrade before relying on
  this skill.

## Step 2: Wire up the agent instructions

Add to the repository's `AGENTS.md` / `CLAUDE.md`:

```md
# Learning more about Effect

This repository uses the Effect TypeScript library.

Before writing any Effect code, first read `node_modules/effect/AGENTS.md` **completely**,
and follow the links in the file when required.

If you need to learn more about particular Effect APIs and concepts that the guide doesn't
cover, search through the source code in `node_modules/effect/src`.
```

## Migrating Effect v3 to v4

Only for crossing the v3/v4 boundary. Every rename, removal and signature change is answered by
generated upstream data — do not guess replacements.

### Workflow

1. Set up and validate the local checkouts (below).
2. Read `.repos/effect/MIGRATION.md` once, and `ls .repos/effect/migration/` for the guide index.
3. Migrate `package.json` first — see **Repo-level changes**. Do this before type-checking, or the
   first run drowns in unresolved-import noise from packages that no longer exist.
4. Run the project's type-check (e.g. `tsc --noEmit`) to get the initial error inventory.
5. Iterate until the type-check is clean. For each error, resolve the API through the lookup
   discipline below, then fix the call site. Never silence an error instead of resolving it.
6. Finish: type-check clean, then run the tests and report their outcome honestly.

### Setup: local checkouts

Two shallow, single-branch clones of the canonical repo:

```sh
git clone --depth 1 --single-branch https://github.com/Effect-TS/effect .repos/effect
git clone --depth 1 --single-branch --branch v3 https://github.com/Effect-TS/effect .repos/effect-v3
```

- `.repos/effect` — v4 (`main`): `MIGRATION.md`, the `migration/` guides, and the v4 source.
- `.repos/effect-v3` — v3 (`v3` branch): escalation-only reference for old semantics.

Each clone is independently re-runnable and separately deletable. Do not use `git worktree` to
share one clone between branches. Keep `.repos/` out of product commits.

**Validate an existing `.repos/effect` before trusting it.** It may be an old clone of the
archived `Effect-TS/effect-smol` repo, which is stale and has no `migration/v3-to-v4.md`:

```sh
git -C .repos/effect remote get-url origin                                    # must be Effect-TS/effect
node -p "require('./.repos/effect/packages/effect/package.json').version"     # must be 4.x
```

If the origin points at `effect-smol`, or the version is not `4.x`, delete the directory and
re-clone.

### Lookup order

1. **`migration/v3-to-v4.md` — the first stop for every API.** Search it; never read it whole.
2. **A per-topic guide** (`.repos/effect/migration/*.md`) when the mapping implies a rewrite
   rather than a rename — e.g. `Context.Tag` → `Context.Service` is structural, not a symbol swap.
   Reach these on demand from the `MIGRATION.md` index; do not front-load them.
3. **v4 source** (`.repos/effect/packages/*/src/`, including `unstable/`) to confirm a
   replacement's real signature before writing code against it.
4. **v3 source** (`.repos/effect-v3`) as escalation only, when unsure of the old semantics.

### Never read the reference doc whole

**The single most important rule in the migration.** `migration/v3-to-v4.md` is ~16,000 lines /
~350k tokens. Reading it in one pass blows the context window and takes the migration with it.

Always search it and read only matched lines plus surrounding context. It has four sections —
**Import Map**, **No Counterpart Imports**, **Removed Modules**, and **API Reference** (one
`` ### `<v3 module path>` `` heading per module). Entries are grep-able one-liners of the form
`` - `Old.symbol` -> `New.symbol`: <rationale> ``; removals are explicit `` -> `none` `` entries
with a stated alternative.

```sh
# Look up a specific v3 symbol
rg -n 'AnthropicTokenizer\.layer' .repos/effect/migration/v3-to-v4.md

# Read a whole module's section via its heading
rg -n -A 40 '^### `@effect/platform/FileSystem`' .repos/effect/migration/v3-to-v4.md

# Resolve a v3 import path in the Import Map
rg -n '^@effect/platform/FileSystem ' .repos/effect/migration/v3-to-v4.md

# List every module section for a package
rg -n '^### `@effect/cluster/' .repos/effect/migration/v3-to-v4.md
```

Look up APIs as you encounter them, one search at a time. A miss in the Import Map is not a dead
end — check **Removed Modules** and **No Counterpart Imports** before concluding anything.

### Repo-level changes

Faithful per-API lookup alone still yields a broken `package.json`. Handle these once, up front:

- **Package consolidation.** `@effect/platform`, `@effect/rpc`, `@effect/cluster` and others merged
  into core `effect` — remove them from `package.json` and rewrite their imports per the Import
  Map. Packages that remain separate (`@effect/platform-*`, `@effect/sql-*`, `@effect/ai-*`,
  `@effect/opentelemetry`, `@effect/vitest`, …) stay as dependencies.
- **Version alignment.** Every remaining `effect` / `@effect/*` dependency must be on the same
  version.
- **Unstable modules.** Some functionality only exists under `effect/unstable/*` (e.g.
  `effect/unstable/http`, `effect/unstable/rpc`, `effect/unstable/cli`, `effect/unstable/sql`).
  These are correct v4 imports; they may take breaking changes in minor releases.

### Delegating to sub-agents

Per-file migration work is context-hungry; do it in sub-agents so the main session's context
survives the whole migration.

- Spawn one sub-agent per file (or per module), giving it the specific v3 symbols to resolve there.
- The sub-agent returns the edit and the mappings it used; the main session keeps the error
  inventory and the running summary.
- Sub-agents inherit the same lookup order, the `rg` recipes, and the prohibitions below.
- The reference doc is never read whole in a sub-agent either — a blown sub-agent context still
  costs the migration that file.

### Done condition

**The project type-checks against v4.** A v4 migration is fundamentally a type-level exercise;
unresolved imports and changed signatures surface there and nowhere else. Run the type-check until
clean.

Running the test suite is recommended and its outcome must be reported honestly — but it is **not**
a gate. A repo mid-migration often has tests that cannot run for unrelated reasons; do not weaken
tests to make them pass.

The final summary must state: the type-check result, the test result (or why tests were not run),
every constructed replacement, and any gaps that were reported rather than bridged.

## Hard prohibitions

- **No invented APIs.** Every API must trace to `node_modules/effect/AGENTS.md`, the shipped
  `node_modules/effect/src/`, a migration guide, or the v4 source. If you cannot find it, say so
  rather than guessing a plausible name.
- **Never write a v3-shaped compatibility layer.** A `v3-compat.ts` re-exporting old names makes
  type errors vanish and permanently freezes the codebase between versions. Migrate the call sites.
- **No `any`, no `as` casts** to silence a post-migration type error. Such an error is usually
  evidence that the replacement has a different shape; casting deletes that information. Go back to
  the reference or the v4 source.
