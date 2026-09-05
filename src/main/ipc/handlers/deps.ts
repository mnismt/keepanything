import type { TestConnectionResult } from '../../../shared/ipc'
import type { ContextMenuKind } from '../../../shared/types'
import type { AuditService } from '../../core/audit'
import type { CollectionService } from '../../core/collection-service'
import type { ItemService } from '../../core/item-service'
import type { RelationshipService } from '../../core/relationship-service'
import type { SettingsStore } from '../../lib/settings'
import type { Queue } from '../../pipeline/queue'
import type { AgentService, AIProvider, Clock, EmbeddingProvider, Intake, Logger, Paths, Retrieval } from '../../ports'
import type { ObjectStore } from '../../storage/object-store'
import type { Repositories } from '../../storage/repositories'
import type { IpcPush } from '../events'

/** Native shell actions the handlers delegate to `desktop/` (injectable for tests). */
export interface DesktopActions {
  openPath(path: string): Promise<void>
  showItemInFolder(path: string): void
  quickLook(path: string): Promise<void>
  openExternal(url: string): Promise<void>
  chooseFiles(): Promise<string[]>
  contextMenu(kind: ContextMenuKind, ids: string[], collectionId?: string): Promise<{ action?: string }>
  /** A drop landed on the shelf: hold the shelf open long enough to show what happened. */
  noteShelfDrop(): void
}

/** Everything the handlers need. Optional ports are absent until their slice lands. */
export interface HandlerDeps {
  items: ItemService
  collections: CollectionService
  relationships: RelationshipService
  audit: AuditService
  repos: Repositories
  queue: Queue
  settings: SettingsStore
  objectStore: ObjectStore
  paths: Paths
  clock: Clock
  logger: Logger
  desktop: DesktopActions
  push: IpcPush
  intake?: Intake
  retrieval?: Retrieval
  agent?: AgentService
  /** Current reasoning provider (rebuilt by the bootstrap when settings change). */
  ai?: () => AIProvider
  embeddings?: EmbeddingProvider
  /** Probe the configured provider. */
  testConnection?: () => Promise<TestConnectionResult>
  /** Called after settings change so the scheduler can pause/resume the ai lane. */
  onSettingsChanged?: () => void
}
