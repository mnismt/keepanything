/**
 * Closed vocabularies: `Understanding.kind` values and the relationship graph's edge types.
 *
 * Zero imports allowed in `src/shared/**` (types from sibling files only).
 */

import type { RelationshipType } from './types'

/** What a kept object *is*, as decided by the understand task. Queryable (`items.kind`). */
export const KINDS = [
  'macos_app',
  'cli_tool',
  'library',
  'saas_product',
  'article',
  'paper',
  'docs',
  'design_reference',
  'screenshot',
  'photo',
  'receipt',
  'video',
  'dataset',
  'note',
  'social_post',
  'other'
] as const

/** One of `KINDS`. */
export type Kind = (typeof KINDS)[number]

/** Human labels for kinds (sentence case, product voice). */
export const KIND_LABEL: Record<Kind, string> = {
  macos_app: 'macOS app',
  cli_tool: 'Command-line tool',
  library: 'Library',
  saas_product: 'Product',
  article: 'Article',
  paper: 'Paper',
  docs: 'Documentation',
  design_reference: 'Design reference',
  screenshot: 'Screenshot',
  photo: 'Photo',
  receipt: 'Receipt',
  video: 'Video',
  dataset: 'Dataset',
  note: 'Note',
  social_post: 'Social post',
  other: 'Other'
}

export function isKind(value: unknown): value is Kind {
  return typeof value === 'string' && (KINDS as readonly string[]).includes(value)
}

/** Labels and symmetry for one relationship type. */
export interface RelationshipTypeInfo {
  /** Symmetric edges are stored once with `sourceItemId < targetItemId`. */
  symmetric: boolean
  /** Label read from the source ("A *inspired by* B"). */
  label: string
  /** Label read from the target ("B *inspired* A"). Equals `label` for symmetric types. */
  inverseLabel: string
}

/** Every relationship type with its labels and symmetry. */
export const RELATIONSHIP_TYPES: Record<RelationshipType, RelationshipTypeInfo> = {
  related_to: { symmetric: true, label: 'related to', inverseLabel: 'related to' },
  inspired_by: { symmetric: false, label: 'inspired by', inverseLabel: 'inspired' },
  same_project: { symmetric: true, label: 'same project', inverseLabel: 'same project' },
  references: { symmetric: false, label: 'references', inverseLabel: 'referenced by' },
  alternative_to: { symmetric: true, label: 'alternative to', inverseLabel: 'alternative to' },
  continuation_of: { symmetric: false, label: 'continuation of', inverseLabel: 'continued by' },
  contradicts: { symmetric: true, label: 'contradicts', inverseLabel: 'contradicts' },
  duplicate_of: { symmetric: true, label: 'duplicate of', inverseLabel: 'duplicate of' },
  created_from: { symmetric: false, label: 'created from', inverseLabel: 'source of' },
  belongs_to: { symmetric: false, label: 'belongs to', inverseLabel: 'contains' }
}

/** Ordered list of relationship type ids (for validation and menus). */
export const RELATIONSHIP_TYPE_IDS = Object.keys(RELATIONSHIP_TYPES) as readonly RelationshipType[]

export function isRelationshipType(value: unknown): value is RelationshipType {
  return typeof value === 'string' && Object.hasOwn(RELATIONSHIP_TYPES, value)
}

/** True for edge types whose meaning does not depend on direction. */
export function isSymmetric(type: RelationshipType): boolean {
  return RELATIONSHIP_TYPES[type].symmetric
}

/** Label for a relationship as seen from one side (`out` = this item is the source). */
export function relationshipLabel(type: RelationshipType, direction: 'out' | 'in'): string {
  const info = RELATIONSHIP_TYPES[type]
  return direction === 'out' ? info.label : info.inverseLabel
}

/**
 * Canonical `[source, target]` order for storage: symmetric types are sorted so `source < target`
 * (plain string comparison); directed types keep the given order.
 */
export function normalizePair(a: string, b: string, type: RelationshipType): [string, string] {
  if (isSymmetric(type) && b < a) return [b, a]
  return [a, b]
}

/** Suppression key for a relationship between two items, regardless of type or direction. */
export function relationshipSuppressionKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}
