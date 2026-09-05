# 014 — One collection shape

Status: Accepted.

## Context

Collections were modelled as a tagged union: `type: 'manual' | 'ai' | 'dynamic'`, with a `query: DynamicQuery | null` for the dynamic kind. The three variants suggested different semantics, but in practice the agent already read every collection's `description` in `collectionContexts()` regardless of `type`, and `CollectionService.materialize()` — the only code that evaluated a `DynamicQuery` — had no caller because the `item.indexed` event had no subscriber. The `dynamic` branch was dead weight that complicated the renderer, the storage schema, the IPC contract, the organize task, and the test fixtures.

The same data structure also held the `LIMITS` thresholds (`MIN_COLLECTION_CONFIDENCE`, `MIN_NEW_COLLECTION_MEMBERS`, `MIN_DESCRIPTION_CHARS`, the `0.6` similarity fold) as local constants. The prompt text in `voice.ts` said `60 characters` while the code enforced `40`, so the prompt could drift from the enforcement.

## Decision

One collection shape. The `type` and `query` columns are gone. The `description` field is the rule the agent reads to decide whether new items belong; that role was already happening, now it's explicit. Membership is always a row in `collection_items`, written by the user or the agent; user writes always win. There is no display-time recompute and no separate `dynamic_member` suppression kind.

Thresholds move into `LIMITS` (`minCollectionConfidence`, `minNewCollectionMembers`, `minCollectionDescriptionChars`, `collectionNameFold`) and the prompt template interpolates them, so the prompt and the code cannot drift.

The renderer loses the `New dynamic collection` button, the type badge, the rule input, the `Only include` select and the dynamic branch of the dialog. A single line of caption under the description field tells the user that the AI uses the description to decide membership — behaviour the agent already had, now documented in the UI.

## Consequences

Saved-search semantics are gone. A user cannot pin "PDFs from the last week" as a one-click view; they have to ask the agent to build a collection or run a search. If that use case comes back, it lands as a separate `savedSearches` feature, not a collection variant.

The `Collection` type in the database loses two columns; existing dev libraries are recreated against `001-init.sql` (the app is unshipped). The `additions.set` in `organize.ts` is load-bearing now that the dynamic fold path is the only path that takes that branch, and the `description too short` rejection uses the same `LIMITS.minCollectionDescriptionChars` the prompt advertises.
