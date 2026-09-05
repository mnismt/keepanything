import { KaError } from '../../core/errors'
import type { HandlerMap } from '../router'
import type { HandlerDeps } from './deps'

type SystemHandlers = Pick<
  HandlerMap,
  | 'system:stats'
  | 'system:contextMenu'
  | 'system:openExternal'
  | 'system:chooseFiles'
  | 'system:revealLibrary'
  | 'jobs:status'
>

export function createSystemHandlers(deps: HandlerDeps): SystemHandlers {
  return {
    'system:stats': () => ({ ...deps.repos.items.stats(), aiStatus: deps.settings.aiStatus() }),
    'system:contextMenu': ({ kind, ids, collectionId }) => deps.desktop.contextMenu(kind, ids, collectionId),
    'system:openExternal': async ({ url }) => {
      if (!/^https:\/\//i.test(url)) throw new KaError('VALIDATION', 'Only https links can be opened.')
      await deps.desktop.openExternal(url)
    },
    'system:chooseFiles': async () => ({ paths: await deps.desktop.chooseFiles() }),
    'system:revealLibrary': () => {
      // Main-only: the renderer never learns or sends a path.
      deps.desktop.showItemInFolder(deps.paths.userData)
    },
    'jobs:status': () => deps.queue.progress()
  }
}
