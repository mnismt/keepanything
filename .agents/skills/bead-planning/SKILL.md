---
name: bead-planning
description: Use when brainstorming features, planning work, or breaking tasks into beads (bd) issues in KeepAnything. Triggers on phrases like "let's plan X", "break this down into tasks", "create beads for X", "design Y", or any session where multiple bd issues will be created. Enforces the epic-first rule (every bead lives under an "Epic N"), the standard template (description shape, bulleted AC, design notes, labels, estimate, spec-id) and the plan-doc-first workflow.
---

# Bead Planning

Brainstorm and decompose work using a **planning doc + lightweight beads** pattern with a **strict standard
template**. Beads track *what to do* and *dependencies*; docs capture *how to do it* and *why*.

Issue prefix is `ka`. Children get hierarchical ids: `ka-<epic>.1`, `ka-<epic>.2`, …

## When to Use

Trigger whenever:

- The user says "let's plan", "design", "brainstorm", "break down", "scope out"
- Work is large enough to warrant >2 bead issues
- The user references an epic, feature, milestone, or multi-phase effort
- You are about to create multiple `bd create` calls in sequence

One-off tickets and trivial follow-ups skip the plan doc — but they **do not** skip the epic (see below).

## Two hard rules

### 1. Every bead lives under an epic

There are no orphan beads in this repo. Every non-epic issue is created with `--parent <epic-id>`.

Before creating anything, find the epic it belongs to:

```bash
bd list --type epic --all
```

If no existing epic fits, **create the next epic first**, then hang the work off it. A single stray task
still gets an epic — if that feels heavy, it usually means the task belongs inside an epic that already
exists.

### 2. Epics are numbered `Epic N`, starting at 0

Epic titles are always `Epic N: <verb-first goal>`. Numbering starts at **Epic 0** and increments by one,
forever — numbers are never reused, even if an epic is closed or abandoned.

| | |
| --- | --- |
| Title | `Epic N: <goal>` |
| Label | `epic:N` (plus the area labels it spans) |
| Existing | `Epic 0: Lock in the KeepAnything architecture baseline` (`ka-dj4`) |

Find the next number by taking the highest `N` already used and adding one:

```bash
bd list --type epic --all        # read the highest "Epic N:" title
```

Children **inherit the epic's labels automatically**, so `epic:N` propagates without being passed again —
which makes `bd list -l epic:3` a complete view of that epic's work. Do not pass `--no-inherit-labels`
unless you have a specific reason.

## Workflow

1. **Clarify scope** — ask 1-3 sharp questions if the goal is fuzzy. Don't draft against a moving target.
2. **Draft the plan doc** at `docs/plans/<slug>/` (folder) or `docs/plans/<slug>.md` (single file).
   Filenames are kebab-case, like everything else in this repo. User reviews before any beads are created.
3. **Create the epic** — `Epic N: <goal>`, `--type epic`, `--labels "epic:N,area:…"`, linked to the plan
   via `--spec-id`.
4. **Create children** one per concrete task, each with `--parent <epic-id>` and full template fields.
5. **Wire dependencies** with `bd dep add <blocked> --blocked-by <blocker>`.
6. **Stop.** Do not commit, push, or `bd dolt push` unless the user asks — see Sync below.

Folder-style plan doc (preferred for non-trivial work):

```
docs/plans/<slug>/
  README.md          # overview, motivation, phase index, success criteria
  phase-1-<name>.md  # detailed design for phase 1
  phase-2-<name>.md
  ...
```

Each phase file becomes the `--spec-id` target for its children. Anchors (`#api-shape`, `#schema`) point at
sub-sections.

## Standard Template (strict — required for every bead)

### Title

- Verb-first imperative
- ≤60 characters
- No project prefix (the prefix lives in the id)
- Epics are the one exception: they carry the `Epic N: ` prefix, and the goal after it is still verb-first
- Examples: `Extract text from PDFs with unpdf`, `Add a suppression row on user removal`

### Description (`--description`)

```
<One-line intent — what and why, single sentence>

<Optional: 1-2 sentences of context, constraints, or non-goals>

See: docs/plans/<slug>/<phase-file>.md#section
```

- Never dump the full spec here. Long content goes in the plan doc.
- The `See:` line is mandatory; the URL fragment points at the precise section.

### Acceptance Criteria (`--acceptance`)

- 3-6 bullets, markdown `- ` style
- Each bullet independently testable
- Concrete and observable — no "should work well", "is performant", "handles edge cases"
- State the externally visible behavior, not the implementation

Example:

```
- capture:drop accepts a raw dataTransfer snapshot and returns an IpcEnvelope
- A drop of 20 mixed files yields 20 items, all reaching READY or PARTIAL
- Classification happens only in main; the renderer sends no kind field
- Payload is zod-validated and a malformed snapshot returns a typed error, not a throw
```

### Design Notes (`--design`)

Use this field whenever the work has non-trivial implementation choices: schema, port shape, stage
ordering, IPC contract, migration order, race conditions. Lives in beads (not in the description) so it
surfaces with `bd show <id>`.

Skip only for truly trivial tasks (docs tweak, config rename).

### Labels (`--labels`)

Three label families, comma-separated:

- **Epic**: `epic:N` — set on the epic, inherited by children. Don't re-pass it.
- **Phase**: `phase:1`, `phase:2`, … — sequencing within the epic. Required on every child.
- **Area**: required on every child, at least one:

  | Label | Covers |
  | --- | --- |
  | `area:shared` | `src/shared/**` — types, ipc, status, kinds, constants |
  | `area:storage` | `node:sqlite`, migrations, FTS5 schema |
  | `area:pipeline` | scheduler, graph, lanes, stage patches, status transitions |
  | `area:capture` | drop intake, hashing, copying into `objects/` |
  | `area:extraction` | text, PDF, URL extraction |
  | `area:previews` | thumbnails, snapshots, `qlmanage` |
  | `area:retrieval` | FTS5 leg, vector leg, RRF fusion, eval |
  | `area:embeddings` | the `utilityProcess` worker, MiniLM, hashed fallback |
  | `area:ai` | GMI provider, structured output, prompts |
  | `area:agent` | agent runs, collections, relationships, audit, suppressions |
  | `area:ipc` | channels, envelope, preload bridge |
  | `area:renderer` | React app, stores, components |
  | `area:ui` | StyleX tokens, layout, motion |
  | `area:desktop` | windows, tray, protocol registration |
  | `area:security` | CSP, sandbox, `ka-media:`, `openExternal` |
  | `area:build` | electron-vite, packaging, dependencies |
  | `area:tests` | Vitest, Playwright, retrieval eval |
  | `area:docs` | brief, architecture, decision records |

Epics get `epic:N` plus the area labels they span, and no phase label.

### Estimate (`--estimate`, minutes)

Pick from the fixed bucket: **30, 60, 120, 240, 360, 480**.

- >480 means split the task.
- <30 means roll it into a sibling.

### Spec link (`--spec-id`)

- Epic: `docs/plans/<slug>/README.md`
- Child: `docs/plans/<slug>/phase-N-<name>.md#section`

This is bd's first-class field for plan linkage — use it instead of (or in addition to) the `See:` line in
the description.

### Priority (`-p` / `--priority`)

- `P0` — blocker, drop everything. Anything breaching the security baseline is P0.
- `P1` — must-have for the epic
- `P2` — should-have, defer if needed
- `P3` — nice-to-have, optional

### Type (`--type`)

`bug | feature | task | epic | chore | decision`. Use `decision` for beads that mirror a record in
`docs/decisions/` — that directory is append-only, so a bead that overturns an accepted decision must
also add a new numbered record and mark the old one superseded.

### Parent

Always `--parent <epic-id>`. Epics have no parent. See hard rule 1.

## Repo-specific requirements

A bead is not plannable until these are answered where they apply.

- **Contract files.** `src/shared/**`, `src/main/ports.ts`, `src/main/ipc/**`, the pipeline
  scheduler/graph/state and the renderer stores are contracts. A bead touching one must say so in
  `--design` and must update every consumer in the same change — never split "widen the port" and "update
  the implementations" into two beads.
- **Quality gates.** Every code bead's AC is implicitly gated on `pnpm run typecheck && pnpm run test`.
  Don't spend an AC bullet on it. Beads touching layout or CSS add "screenshot reviewed" as a real bullet.
- **Testability rule.** Nothing under `core/ capture/ extraction/ retrieval/ agent/ pipeline/ storage/ ai/`
  imports `electron` or reads `process.env`. If a bead needs a new external seam, it needs a port —
  say which one in `--design`.
- **Degradation.** Any bead adding an AI-dependent step states what happens with `KEEPANYTHING_AI=off`.
  A missing model parks work; it never fails a capture.
- **Agent writes.** Any bead giving the agent a new capability routes it through an audited service and
  says which one.

## Canonical Examples

### Epic

```bash
bd create "Epic 1: Ship the Ask My Stuff answer panel" \
  --type epic \
  -p P1 \
  --labels "epic:1,area:retrieval,area:ai,area:renderer" \
  --spec-id "docs/plans/ask-my-stuff/README.md" \
  --description "$(cat <<'EOF'
Put a grounded answer surface on top of the existing hybrid retrieval, with citations back to the items it used and no private search path for the agent.

See: docs/plans/ask-my-stuff/README.md
EOF
)" \
  --acceptance "$(cat <<'EOF'
- Asking a question returns an answer with a citation per source item
- Clicking a citation opens that item in the detail view
- The agent retrieves through the same Retrieval port the palette uses
- With KEEPANYTHING_AI=off the panel explains that answering is unavailable and search still works
- Answers stream, and a cancelled question leaves no partial state
EOF
)"
```

### Child

```bash
bd create "Render citations as item chips in the answer panel" \
  --parent ka-abc \
  -p P1 \
  --labels "phase:2,area:renderer,area:ui" \
  --estimate 240 \
  --spec-id "docs/plans/ask-my-stuff/phase-2-panel.md#citations" \
  --description "$(cat <<'EOF'
Show each cited item as a chip under the answer so a claim can be traced back to the thing it came from.

See: docs/plans/ask-my-stuff/phase-2-panel.md#citations
EOF
)" \
  --acceptance "$(cat <<'EOF'
- Each citation renders as a chip with the item title and kind icon
- Clicking a chip selects that item in the library and closes the panel
- A citation whose item was deleted renders as a disabled chip, not a crash
- Chips wrap without shifting the answer text, down to a 720px window
- Screenshot reviewed at both window sizes
EOF
)" \
  --design "$(cat <<'EOF'
Chips are a new component in components/detail/, styled from tokens.stylex.ts only — no hard-coded colours.
Answer payload carries citations: { itemId, span }[]; the renderer resolves titles from the existing
items store rather than a new IPC round-trip. Deleted items resolve to undefined, which is the disabled case.
Motion respects prefers-reduced-motion.
EOF
)"
```

Then wire dependencies:

```bash
bd dep add ka-abc.7 --blocked-by ka-abc.1   # answer contract in src/shared
bd dep add ka-abc.7 --blocked-by ka-abc.4   # retrieval returns spans
```

## Bulk Creation From a Plan Doc

If the plan doc has a markdown checklist with anchors, bulk-generate skeletons:

```bash
EPIC=ka-abc
PLAN_DIR=docs/plans/ask-my-stuff
# Each line in tasks.tsv: title<TAB>phase<TAB>area<TAB>estimate<TAB>spec-anchor
while IFS=$'\t' read -r title phase area est anchor; do
  bd create "$title" \
    --parent "$EPIC" \
    -p P1 \
    --labels "phase:$phase,area:$area" \
    --estimate "$est" \
    --spec-id "$PLAN_DIR/phase-$phase-$area.md#$anchor" \
    --description "See: $PLAN_DIR/phase-$phase-$area.md#$anchor"
done < tasks.tsv
```

Use a quoted heredoc (`<<'ROWS'`) for inline rows so backticks and `$` in titles are not expanded by the
shell. Review every created issue afterward and fill in `--description`/`--acceptance`/`--design`. Bulk
gets the skeletons; details are still hand-written.

## Sync

This repo runs the **conservative** agent profile from `AGENTS.md`. Beads live in a gitignored Dolt DB;
`export.auto` is off, so nothing lands in git on its own.

- Do **not** run `git commit`, `git push` or `bd dolt push` unless the user asks.
- At handoff, report what changed and the exact commands you would run.
- To make issues reviewable in a PR, the user can opt in with `bd config set export.auto true`, which
  writes `.beads/issues.jsonl`.

## Rules

- **Never** create a bead without `--parent`. Every ticket lives under an epic.
- **Never** invent an epic number — read the highest `Epic N` and add one. Numbers are never reused.
- **Never** create beads before the plan doc exists (epic + plan doc can be created together).
- **Never** dump full specs into bead descriptions — the doc is the source of truth.
- **Always** populate `--spec-id`, `--labels` (phase + area), `--estimate`, `--acceptance`.
- **Always** use bulleted acceptance criteria, not prose.
- **Always** prefer folder-style plan docs once a plan exceeds ~150 lines or has >3 phases.
- If a bead has non-trivial implementation choices, it **must** have `--design`.
- One epic per plan doc. Cross-epic dependencies go through `bd dep add`.

## Quick Reference

```bash
bd list --type epic --all             # epics, to find the next N and the right parent
bd list -l epic:3                     # everything under Epic 3
bd ready                              # unblocked work
bd show <id>                          # view (includes description, AC, design)
bd create "Epic N: Goal" --type epic --labels "epic:N,area:…"
bd create "Title" --parent <epic-id> --labels "phase:1,area:…"
bd dep add <id> --blocked-by <id>     # dependency
bd update <id> --claim                # take ownership
bd close <id> --reason "…"            # complete
bd prime                              # full bd reference
```
