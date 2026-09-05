import type { Stage } from '../../../shared/types'
import type { StageDefinition } from '../../ports'
import { consolidateStage } from './consolidate'
import { embedStage } from './embed'
import { extractStage } from './extract'
import { indexStage } from './index-stage'
import { organizeBatchStage } from './organize-batch'
import { relateStage } from './relate'
import { snapshotStage } from './snapshot'
import { thumbnailStage } from './thumbnail'
import { understandStage } from './understand'

/**
 * The frozen stage list (contract). Slices replace the `run` bodies in the individual files behind
 * the exported names imported here; nobody adds or renames entries.
 */
export const STAGES: readonly StageDefinition[] = Object.freeze([
  extractStage,
  thumbnailStage,
  snapshotStage,
  embedStage,
  indexStage,
  understandStage,
  relateStage,
  organizeBatchStage,
  consolidateStage
])

export function stageByName(name: Stage): StageDefinition {
  const stage = STAGES.find((s) => s.name === name)
  if (!stage) throw new Error(`Unknown stage "${name}"`)
  return stage
}
