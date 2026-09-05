import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type AuditService, createAuditService } from '../../../src/main/core/audit'
import { type CollectionService, createCollectionService } from '../../../src/main/core/collection-service'
import { createEventBus } from '../../../src/main/core/events'
import { type IdGenerator, sequentialIds } from '../../../src/main/core/ids'
import { createItemService, type ItemService, type NewItemInput } from '../../../src/main/core/item-service'
import { createRelationshipService, type RelationshipService } from '../../../src/main/core/relationship-service'
import { createManualClock, type ManualClock } from '../../../src/main/lib/clock'
import { createQueue, type Queue } from '../../../src/main/pipeline/queue'
import { createStateApplier, type StateApplier } from '../../../src/main/pipeline/state'
import type { DomainEventMap, DomainEventName, EventBus, Paths } from '../../../src/main/ports'
import { type Db, openDatabase } from '../../../src/main/storage/db'
import { createObjectStore, type ObjectStore } from '../../../src/main/storage/object-store'
import { buildPaths, ensureLibraryDirs } from '../../../src/main/storage/paths'
import { createRepositories, type Repositories } from '../../../src/main/storage/repositories'
import type { Item } from '../../../src/shared/types'

/** A recorded domain event. */
export interface RecordedEvent {
  name: DomainEventName
  payload: unknown
}

/** Everything a unit test needs, over an in-memory database. */
export interface Harness {
  db: Db
  repos: Repositories
  events: EventBus
  recorded: RecordedEvent[]
  clock: ManualClock
  ids: IdGenerator
  audit: AuditService
  queue: Queue
  state: StateApplier
  items: ItemService
  collections: CollectionService
  relationships: RelationshipService
  objectStore: ObjectStore
  paths: Paths
  /** Create an item with sensible defaults. */
  item(overrides?: Partial<NewItemInput> & { type?: Item['type'] }): Item
  eventsNamed<E extends DomainEventName>(name: E): DomainEventMap[E][]
  close(): void
}

/** Build a harness. `withFiles` creates a temp library directory for the object store. */
export function createHarness(options: { file?: string; withFiles?: boolean } = {}): Harness {
  const db = openDatabase(options.file ?? ':memory:')
  db.migrate()
  const repos = createRepositories(db)
  const recorded: RecordedEvent[] = []
  const inner = createEventBus()
  const events: EventBus = {
    on: inner.on,
    off: inner.off,
    emit(name, payload) {
      recorded.push({ name, payload })
      inner.emit(name, payload)
    }
  }
  const clock = createManualClock('2026-09-03T10:00:00.000Z')
  const ids = sequentialIds('id')
  const audit = createAuditService({ db, repos, events, clock, ids })
  const queue = createQueue({ jobs: repos.jobs, clock, ids: sequentialIds('job') })
  const state = createStateApplier({ db, repos, queue, clock })
  const items = createItemService({ db, repos, events, clock, audit, pipeline: queue, ids })
  const collections = createCollectionService({ db, repos, events, clock, audit, ids: sequentialIds('col') })
  const relationships = createRelationshipService({ db, repos, events, clock, audit, ids: sequentialIds('rel') })
  const root = options.withFiles ? mkdtempSync(join(tmpdir(), 'ka-test-')) : join(tmpdir(), 'ka-test-unused')
  const paths = buildPaths(root)
  if (options.withFiles) ensureLibraryDirs(paths)
  const objectStore = createObjectStore(paths)
  let n = 0
  return {
    db,
    repos,
    events,
    recorded,
    clock,
    ids,
    audit,
    queue,
    state,
    items,
    collections,
    relationships,
    objectStore,
    paths,
    item(overrides = {}) {
      n += 1
      return items.create({ type: 'text', title: `Item ${n}`, ...overrides })
    },
    eventsNamed(name) {
      return recorded.filter((e) => e.name === name).map((e) => e.payload as never)
    },
    close() {
      db.close()
      if (options.withFiles) rmSync(root, { recursive: true, force: true })
    }
  }
}
