import type { IpcEventMap, IpcEventName } from '../../shared/ipc'
import type { EventBus, Logger } from '../ports'

/** Something that can receive a push event (a `WebContents`, or a fake in tests). */
export interface PushTarget {
  send(channel: string, payload: unknown): void
  isDestroyed?(): boolean
}

/** Typed push to every app window. */
export interface IpcPush {
  send<E extends IpcEventName>(event: E, payload: IpcEventMap[E]): void
}

/** Create the push helper. `targets()` returns the live app windows' web contents. */
export function createIpcPush(targets: () => PushTarget[], logger?: Logger): IpcPush {
  return {
    send(event, payload) {
      for (const target of targets()) {
        if (target.isDestroyed?.()) continue
        try {
          target.send(event, payload)
        } catch (error) {
          logger?.debug('push failed', { event, error })
        }
      }
    }
  }
}

/** Forward domain events to the renderer. Returns an unsubscribe function. */
export function bridgeDomainEvents(events: EventBus, push: IpcPush): () => void {
  const subs = [
    events.on('item.created', (p) => push.send('items:changed', p)),
    events.on('item.updated', (p) => push.send('items:changed', p)),
    events.on('item.trashed', (p) => push.send('items:changed', p)),
    events.on('item.restored', (p) => push.send('items:changed', p)),
    events.on('item.deleted', (p) => push.send('items:changed', p)),
    events.on('job.progress', (p) => push.send('jobs:progress', p)),
    events.on('collections.changed', (p) => push.send('collections:changed', p)),
    events.on('agent.run', (p) => push.send('agent:run', p)),
    events.on('settings.changed', (p) => push.send('settings:changed', p))
  ]
  return () => {
    for (const off of subs) off()
  }
}
