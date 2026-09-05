import type { Db } from '../db'
import { type AgentRunRepo, createAgentRunRepo } from './agent-run-repo'
import { type AuditRepo, createAuditRepo } from './audit-repo'
import { type CollectionRepo, createCollectionRepo } from './collection-repo'
import { createEmbeddingRepo, type EmbeddingRepo } from './embedding-repo'
import { createItemRepo, type ItemRepo } from './item-repo'
import { createJobRepo, type JobRepo } from './job-repo'
import { createRelationshipRepo, type RelationshipRepo } from './relationship-repo'
import { createSuppressionRepo, type SuppressionRepo } from './suppression-repo'

/** Every repository, keyed by the names used in `StageDeps.repos`. */
export interface Repositories {
  items: ItemRepo
  collections: CollectionRepo
  relationships: RelationshipRepo
  embeddings: EmbeddingRepo
  agentRuns: AgentRunRepo
  jobs: JobRepo
  audit: AuditRepo
  suppressions: SuppressionRepo
}

export function createRepositories(db: Db): Repositories {
  return {
    items: createItemRepo(db),
    collections: createCollectionRepo(db),
    relationships: createRelationshipRepo(db),
    embeddings: createEmbeddingRepo(db),
    agentRuns: createAgentRunRepo(db),
    jobs: createJobRepo(db),
    audit: createAuditRepo(db),
    suppressions: createSuppressionRepo(db)
  }
}

export type {
  AgentRunRepo,
  AuditRepo,
  CollectionRepo,
  EmbeddingRepo,
  ItemRepo,
  JobRepo,
  RelationshipRepo,
  SuppressionRepo
}
