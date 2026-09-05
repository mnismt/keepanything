import type { DomainEventMap, DomainEventName, EventBus, Logger } from '../ports'

type Listener = (payload: never) => void

/**
 * Typed synchronous in-process event bus. Listener errors are logged and swallowed so one broken
 * subscriber (e.g. a closed window) never breaks a domain mutation.
 */
export function createEventBus(logger?: Logger): EventBus {
  const listeners = new Map<DomainEventName, Set<Listener>>()

  const off: EventBus['off'] = (event, listener) => {
    listeners.get(event)?.delete(listener as Listener)
  }

  return {
    on(event, listener) {
      let set = listeners.get(event)
      if (!set) {
        set = new Set()
        listeners.set(event, set)
      }
      set.add(listener as Listener)
      return () => off(event, listener)
    },
    off,
    emit<E extends DomainEventName>(event: E, payload: DomainEventMap[E]) {
      const set = listeners.get(event)
      if (!set) return
      for (const listener of [...set]) {
        try {
          ;(listener as (p: DomainEventMap[E]) => void)(payload)
        } catch (error) {
          logger?.error('event listener failed', { event, error })
        }
      }
    }
  }
}
