/**
 * The closed vocabulary of item actions, shared by the detail view and the agent.
 * The model may only *suggest* ids from this list (`items.suggested_actions`).
 *
 * Zero imports allowed in `src/shared/**` (types from sibling files only).
 */

import type { Kind } from './kinds'
import type { ItemSubtype, ItemSummary, ItemType } from './types'

/** Where an action applies: a whole type, a `type:subtype` pair, or an understanding `kind`. */
export type ActionTarget = ItemType | `${ItemType}:${ItemSubtype}` | `kind:${Kind}`

/** One entry of `ITEM_ACTIONS`. */
export interface ItemAction {
  id: ActionId
  /** Menu label, product voice (verb first). */
  label: string
  /** One-line description shown as help / used in the agent prompt. */
  description: string
  /** Targets this action is offered for by default. */
  appliesTo: readonly ActionTarget[]
  /** True when the run creates a note item (with sources) instead of an inline answer. */
  producesNote: boolean
}

export type ActionId =
  | 'explain_architecture'
  | 'compare_with_saved_repos'
  | 'extract_ideas'
  | 'read_readme'
  | 'summarize_argument'
  | 'extract_claims'
  | 'compare_with_related'
  | 'add_to_research_brief'
  | 'describe_visual_language'
  | 'find_similar_references'
  | 'extract_design_ideas'
  | 'extract_transaction'
  | 'find_related_purchases'
  | 'summarize_page'
  | 'extract_key_points'
  | 'describe_folder'
  | 'list_key_files'

const REPO: readonly ActionTarget[] = ['url:github_repo']
const READING: readonly ActionTarget[] = ['url:article', 'url:paper', 'pdf', 'markdown', 'text']
const VISUAL: readonly ActionTarget[] = ['image', 'url:figma', 'image:design', 'image:screenshot']
const RECEIPT: readonly ActionTarget[] = ['kind:receipt']
const URL_GENERIC: readonly ActionTarget[] = ['url']
const FOLDER: readonly ActionTarget[] = ['folder']

/** The action catalogue, in display order. */
export const ITEM_ACTIONS: readonly ItemAction[] = [
  {
    id: 'explain_architecture',
    label: 'Explain architecture',
    description: 'Read the repository and explain how it is put together.',
    appliesTo: REPO,
    producesNote: false
  },
  {
    id: 'compare_with_saved_repos',
    label: 'Compare with saved repos',
    description: 'Compare this repository with related repositories in the library.',
    appliesTo: REPO,
    producesNote: true
  },
  {
    id: 'extract_ideas',
    label: 'Extract useful ideas',
    description: 'Pull out techniques and ideas worth reusing, as a note.',
    appliesTo: REPO,
    producesNote: true
  },
  {
    id: 'read_readme',
    label: 'Read README',
    description: 'Summarize what the README says this project does and how to use it.',
    appliesTo: REPO,
    producesNote: false
  },
  {
    id: 'summarize_argument',
    label: 'Summarize argument',
    description: 'State the main argument and how it is supported.',
    appliesTo: READING,
    producesNote: false
  },
  {
    id: 'extract_claims',
    label: 'Extract claims',
    description: 'List the concrete claims and figures, as a note.',
    appliesTo: READING,
    producesNote: true
  },
  {
    id: 'compare_with_related',
    label: 'Compare with related',
    description: 'Compare this with related items in the library, as a note.',
    appliesTo: READING,
    producesNote: true
  },
  {
    id: 'add_to_research_brief',
    label: 'Add to research brief',
    description: 'Fold the key points into a research brief note that cites this item.',
    appliesTo: READING,
    producesNote: true
  },
  {
    id: 'describe_visual_language',
    label: 'Describe visual language',
    description: 'Describe typography, colour, layout and mood.',
    appliesTo: VISUAL,
    producesNote: false
  },
  {
    id: 'find_similar_references',
    label: 'Find similar references',
    description: 'Find visually or thematically similar references in the library.',
    appliesTo: VISUAL,
    producesNote: false
  },
  {
    id: 'extract_design_ideas',
    label: 'Extract design ideas',
    description: 'Capture typography, colour and layout ideas worth borrowing, as a note.',
    appliesTo: VISUAL,
    producesNote: true
  },
  {
    id: 'extract_transaction',
    label: 'Extract transaction',
    description: 'Pull out merchant, date, amount and line items, as a note.',
    appliesTo: RECEIPT,
    producesNote: true
  },
  {
    id: 'find_related_purchases',
    label: 'Find related purchases',
    description: 'Find other receipts from the same merchant or period.',
    appliesTo: RECEIPT,
    producesNote: false
  },
  {
    id: 'summarize_page',
    label: 'Summarize page',
    description: 'Summarize what this page is about.',
    appliesTo: URL_GENERIC,
    producesNote: false
  },
  {
    id: 'extract_key_points',
    label: 'Extract key points',
    description: 'List the key points of this page, as a note.',
    appliesTo: URL_GENERIC,
    producesNote: true
  },
  {
    id: 'describe_folder',
    label: 'Describe folder',
    description: 'Explain what this folder contains and what it seems to be for.',
    appliesTo: FOLDER,
    producesNote: false
  },
  {
    id: 'list_key_files',
    label: 'List key files',
    description: 'Point out the files that matter most in this folder.',
    appliesTo: FOLDER,
    producesNote: false
  }
]

/** Maximum number of default actions offered for one item. */
export const MAX_DEFAULT_ACTIONS = 4

const ACTION_BY_ID: ReadonlyMap<string, ItemAction> = new Map(ITEM_ACTIONS.map((a) => [a.id, a]))

export function isActionId(value: unknown): value is ActionId {
  return typeof value === 'string' && ACTION_BY_ID.has(value)
}

export function actionById(id: ActionId): ItemAction {
  const action = ACTION_BY_ID.get(id)
  if (!action) throw new Error(`Unknown action id: ${id}`)
  return action
}

/**
 * Default actions for an item, deterministic, at most `MAX_DEFAULT_ACTIONS`:
 * 1. `type:subtype` matches (e.g. `url:github_repo`), catalogue order;
 * 2. `kind:` matches (e.g. `kind:receipt`), catalogue order;
 * 3. type-wide matches (e.g. `url`, `image`) only when no subtype-specific action matched, so
 *    generic page actions never pad a specialised list.
 */
export function actionsForItem(summary: Pick<ItemSummary, 'type' | 'subtype' | 'kind'>): ItemAction[] {
  const typed: ActionTarget = summary.type
  const subtyped: ActionTarget | null = summary.subtype ? `${summary.type}:${summary.subtype}` : null
  const kinded: ActionTarget | null = summary.kind ? `kind:${summary.kind}` : null

  const bySubtype = subtyped ? ITEM_ACTIONS.filter((a) => a.appliesTo.includes(subtyped)) : []
  const byKind = kinded ? ITEM_ACTIONS.filter((a) => a.appliesTo.includes(kinded)) : []
  const byType = bySubtype.length > 0 ? [] : ITEM_ACTIONS.filter((a) => a.appliesTo.includes(typed))

  const seen = new Set<ActionId>()
  const result: ItemAction[] = []
  for (const action of [...bySubtype, ...byKind, ...byType]) {
    if (seen.has(action.id)) continue
    seen.add(action.id)
    result.push(action)
    if (result.length === MAX_DEFAULT_ACTIONS) break
  }
  return result
}
