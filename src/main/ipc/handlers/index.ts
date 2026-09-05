import type { HandlerMap } from '../router'
import { createAgentHandlers } from './agent'
import { createCaptureHandlers } from './capture'
import { createCollectionHandlers } from './collections'
import type { HandlerDeps } from './deps'
import { createItemHandlers } from './items'
import { createSettingsHandlers } from './settings'
import { createSystemHandlers } from './system'

/** Assemble the full handler map (one handler per `IPC_CHANNELS` entry, enforced by the type). */
export function createHandlers(deps: HandlerDeps): HandlerMap {
  return {
    ...createItemHandlers(deps),
    ...createCaptureHandlers(deps),
    ...createCollectionHandlers(deps),
    ...createAgentHandlers(deps),
    ...createSettingsHandlers(deps),
    ...createSystemHandlers(deps)
  }
}

export type { DesktopActions, HandlerDeps } from './deps'
