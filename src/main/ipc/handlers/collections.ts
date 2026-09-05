import type { HandlerMap } from '../router'
import type { HandlerDeps } from './deps'

type CollectionHandlers = Pick<
  HandlerMap,
  | 'collections:list'
  | 'collections:create'
  | 'collections:createDynamic'
  | 'collections:rename'
  | 'collections:delete'
  | 'collections:addItems'
  | 'collections:removeItem'
  | 'relationships:create'
  | 'relationships:remove'
>

export function createCollectionHandlers(deps: HandlerDeps): CollectionHandlers {
  const { collections, relationships } = deps
  return {
    'collections:list': () => collections.list(),
    'collections:create': ({ name, description }) =>
      collections.create({ name, description: description ?? null, type: 'manual', createdBy: 'user' }),
    'collections:createDynamic': ({ name, description, query }) =>
      collections.create({ name, description: description ?? null, type: 'dynamic', query, createdBy: 'user' }),
    'collections:rename': ({ id, name, description }) => {
      collections.rename(id, name, description, { actor: 'user' })
    },
    'collections:delete': ({ id }) => {
      collections.delete(id, { actor: 'user' })
    },
    'collections:addItems': ({ id, itemIds }) => {
      collections.addItems(
        id,
        itemIds.map((itemId) => ({ itemId })),
        { actor: 'user' }
      )
    },
    'collections:removeItem': ({ id, itemId }) => {
      collections.removeItem(id, itemId, { actor: 'user' })
    },
    'relationships:create': ({ sourceId, targetId, type, description }) =>
      relationships.create({ sourceId, targetId, type, description: description ?? null, createdBy: 'user' }),
    'relationships:remove': ({ id }) => {
      relationships.remove(id, { actor: 'user' })
    }
  }
}
