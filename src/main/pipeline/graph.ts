import { LIMITS } from '../../shared/constants'
import type { ItemType, Lane, Stage } from '../../shared/types'

/**
 * Pipeline graph: which stages an item type runs and in what order. Pure data +
 * functions; the scheduler consults it after every finished job. A stage becomes runnable when
 * every stage it waits for has *finished* (done or failed): previews never block understanding,
 * and an extraction failure still leads to understanding on metadata only.
 */
interface Node {
  stage: Stage
  after: readonly Stage[]
}

const URL_GRAPH: readonly Node[] = [
  { stage: 'extract', after: [] },
  { stage: 'snapshot', after: [] },
  { stage: 'embed', after: ['extract', 'snapshot'] },
  { stage: 'understand', after: ['extract', 'snapshot'] },
  { stage: 'index', after: ['understand'] },
  { stage: 'relate', after: ['index'] }
]

const IMAGE_GRAPH: readonly Node[] = [
  { stage: 'thumbnail', after: [] },
  { stage: 'understand', after: ['thumbnail'] },
  { stage: 'index', after: ['understand'] },
  { stage: 'relate', after: ['index'] }
]

const DOCUMENT_GRAPH: readonly Node[] = [
  { stage: 'extract', after: [] },
  { stage: 'thumbnail', after: [] },
  { stage: 'embed', after: ['extract', 'thumbnail'] },
  { stage: 'understand', after: ['extract', 'thumbnail'] },
  { stage: 'index', after: ['understand'] },
  { stage: 'relate', after: ['index'] }
]

const FOLDER_GRAPH: readonly Node[] = [
  { stage: 'extract', after: [] },
  { stage: 'understand', after: ['extract'] },
  { stage: 'index', after: ['understand'] },
  { stage: 'relate', after: ['index'] }
]

/** Notes skip understand/relate: their text is already the understanding. */
const NOTE_GRAPH: readonly Node[] = [
  { stage: 'embed', after: [] },
  { stage: 'index', after: [] }
]

const GRAPHS: Record<ItemType, readonly Node[]> = {
  url: URL_GRAPH,
  image: IMAGE_GRAPH,
  pdf: DOCUMENT_GRAPH,
  text: DOCUMENT_GRAPH,
  markdown: DOCUMENT_GRAPH,
  file: DOCUMENT_GRAPH,
  video: DOCUMENT_GRAPH,
  audio: DOCUMENT_GRAPH,
  unknown: DOCUMENT_GRAPH,
  folder: FOLDER_GRAPH,
  note: NOTE_GRAPH
}

/** Lane of each stage (`LIMITS.lanes` gives the concurrency). */
export const STAGE_LANE: Record<Stage, Lane> = {
  extract: 'io',
  thumbnail: 'io',
  snapshot: 'io',
  embed: 'embed',
  index: 'embed',
  understand: 'ai',
  relate: 'ai',
  organize_batch: 'ai',
  consolidate: 'ai'
}

/** Base priority per stage: understand > extract > index > previews > relate/embed > batch > consolidate. */
export const STAGE_PRIORITY: Record<Stage, number> = {
  understand: 30,
  extract: 25,
  index: 20,
  thumbnail: 15,
  snapshot: 15,
  relate: 10,
  embed: 10,
  organize_batch: 10,
  consolidate: 0
}

/** Priority penalty for children of folders so a big drop never starves single items. */
export const CHILD_PRIORITY_PENALTY = 5

/** Every stage of the graph for `type`, in declaration order. */
export function stagesFor(type: ItemType): Stage[] {
  return GRAPHS[type].map((n) => n.stage)
}

/** Enqueued at capture. */
export function initialStages(type: ItemType): Stage[] {
  return GRAPHS[type].filter((n) => n.after.length === 0).map((n) => n.stage)
}

/**
 * Stages unlocked by `finished` given the set of stages that have finished so far (which must
 * include `finished` itself). Stages already in `finishedSet` are not returned again.
 */
export function nextStages(type: ItemType, finished: Stage, finishedSet: ReadonlySet<Stage>): Stage[] {
  return GRAPHS[type]
    .filter((n) => n.after.includes(finished))
    .filter((n) => !finishedSet.has(n.stage))
    .filter((n) => n.after.every((dep) => finishedSet.has(dep)))
    .map((n) => n.stage)
}

/** True when nothing in the graph waits for `stage` (lets `next()` settle the item). */
export function isLastStage(type: ItemType, stage: Stage): boolean {
  const graph = GRAPHS[type]
  if (!graph.some((n) => n.stage === stage)) return false
  return !graph.some((n) => n.after.includes(stage))
}

/** `from` plus everything downstream of it (what `items:reprocess { from }` re-runs). */
export function stagesFrom(type: ItemType, from: Stage): Stage[] {
  const graph = GRAPHS[type]
  if (!graph.some((n) => n.stage === from)) return []
  const out = new Set<Stage>([from])
  let grew = true
  while (grew) {
    grew = false
    for (const n of graph) {
      if (!out.has(n.stage) && n.after.some((dep) => out.has(dep))) {
        out.add(n.stage)
        grew = true
      }
    }
  }
  return graph.filter((n) => out.has(n.stage)).map((n) => n.stage)
}

/** Effective priority for a job. */
export function stagePriority(stage: Stage, opts: { isChild?: boolean } = {}): number {
  return STAGE_PRIORITY[stage] - (opts.isChild ? CHILD_PRIORITY_PENALTY : 0)
}

export const LANE_CAPACITY: Record<Lane, number> = LIMITS.lanes
