import { cp, mkdir } from 'node:fs/promises'
import { EMBEDDING_DIMS, EMBEDDING_MODEL_ID } from '../../../shared/constants'
import type { EmbeddingProvider, Logger, WorkerClient } from '../../ports'
import { createHashEmbeddingProvider, HASH_EMBEDDING_ID, HASH_EMBEDDING_MODEL } from './hash'
import { missingModelFiles, modelDir, modelFilesPresent } from './model-files'
import { EMBED_BATCH_SIZE } from './transformers'
import type { EmbedInitResult } from './worker-tasks'

export {
  createHashEmbeddingProvider,
  fnv1a,
  HASH_EMBEDDING_ID,
  HASH_EMBEDDING_MODEL,
  hashEmbed,
  tokenize
} from './hash'
export { MODEL_FILES, missingModelFiles, modelDir, modelFilesPresent } from './model-files'
export {
  createEmbeddingWorkerTasks,
  EMBEDDING_WORKER_TASKS,
  type EmbedInitResult,
  type EmbedStatus
} from './worker-tasks'

/** Provider id when the model runs. */
export const LOCAL_EMBEDDING_ID = 'local'

export interface CreateEmbeddingProviderOptions {
  /** Worker client; absent -> fallback only. */
  worker?: WorkerClient
  /** `Paths.modelsDir`. */
  modelsDir: string
  /** `Paths.resourcesModelsDir`: copied into `modelsDir` when the model is missing there. */
  resourcesModelsDir?: string
  logger: Logger
  modelId?: string
  /** Budget for `embed.init` (cold load ≈ 100 ms; generous for slow disks). */
  initTimeoutMs?: number
  /** Budget for one `embed.texts` batch. */
  embedTimeoutMs?: number
}

/** `EmbeddingProvider` with introspection for the Settings screen. */
export interface LocalEmbeddingProvider extends EmbeddingProvider {
  backend(): 'local' | 'local-hash'
  /** True when the model files exist under `modelsDir`. */
  modelPresent(): boolean
}

/** Copy model files from `fromDir` into `toDir` when `toDir` lacks them. Returns true when complete. */
export async function seedModelFiles(
  fromDir: string,
  toDir: string,
  modelId: string = EMBEDDING_MODEL_ID,
  logger?: Logger
): Promise<boolean> {
  if (modelFilesPresent(toDir, modelId)) return true
  if (!modelFilesPresent(fromDir, modelId)) return false
  try {
    await mkdir(modelDir(toDir, modelId), { recursive: true })
    await cp(modelDir(fromDir, modelId), modelDir(toDir, modelId), {
      recursive: true,
      force: false,
      errorOnExist: false
    })
    logger?.info('embeddings.seeded', { from: fromDir, to: toDir })
    return modelFilesPresent(toDir, modelId)
  } catch (error) {
    logger?.warn('embeddings.seed_failed', { from: fromDir, to: toDir, error })
    return false
  }
}

/** Create the provider. `ready()` decides the backend once (memoized); `embed()` waits for it. */
export function createEmbeddingProvider(opts: CreateEmbeddingProviderOptions): LocalEmbeddingProvider {
  const modelId = opts.modelId ?? EMBEDDING_MODEL_ID
  const logger = opts.logger.child({ scope: 'embeddings' })
  const fallback = createHashEmbeddingProvider(EMBEDDING_DIMS)
  const initTimeoutMs = opts.initTimeoutMs ?? 60_000
  const embedTimeoutMs = opts.embedTimeoutMs ?? 60_000
  let backend: 'local' | 'local-hash' = 'local-hash'
  let readyPromise: Promise<boolean> | null = null
  let activeDims = EMBEDDING_DIMS

  async function init(): Promise<boolean> {
    if (!opts.worker) {
      logger.warn('embeddings.fallback', { reason: 'no worker', modelsDir: opts.modelsDir })
      return true
    }
    if (!modelFilesPresent(opts.modelsDir, modelId) && opts.resourcesModelsDir) {
      await seedModelFiles(opts.resourcesModelsDir, opts.modelsDir, modelId, logger)
    }
    const missing = missingModelFiles(opts.modelsDir, modelId)
    if (missing.length > 0) {
      logger.warn('embeddings.fallback', { reason: 'model files missing', missing, modelsDir: opts.modelsDir })
      return true
    }
    try {
      const result = await opts.worker.call<EmbedInitResult>(
        'embed.init',
        { modelsDir: opts.modelsDir, modelId },
        { timeoutMs: initTimeoutMs }
      )
      backend = 'local'
      activeDims = result.dims
      logger.info('embeddings.ready', { backend, modelId: result.modelId, dims: result.dims, loadMs: result.loadMs })
    } catch (error) {
      backend = 'local-hash'
      logger.warn('embeddings.fallback', { reason: 'embed.init failed', error })
    }
    return true
  }

  function ready(): Promise<boolean> {
    if (!readyPromise) readyPromise = init()
    return readyPromise
  }

  async function embedWithWorker(texts: string[]): Promise<Float32Array[]> {
    const worker = opts.worker as WorkerClient
    const out: Float32Array[] = []
    for (let start = 0; start < texts.length; start += EMBED_BATCH_SIZE) {
      const batch = texts.slice(start, start + EMBED_BATCH_SIZE)
      let vectors: number[][]
      try {
        vectors = await worker.call<number[][]>('embed.texts', { texts: batch }, { timeoutMs: embedTimeoutMs })
      } catch (error) {
        // The worker may have restarted (model state lost): re-init once and retry this batch.
        logger.warn('embeddings.retry', { error })
        await worker.call<EmbedInitResult>(
          'embed.init',
          { modelsDir: opts.modelsDir, modelId },
          { timeoutMs: initTimeoutMs }
        )
        vectors = await worker.call<number[][]>('embed.texts', { texts: batch }, { timeoutMs: embedTimeoutMs })
      }
      if (vectors.length !== batch.length)
        throw new Error(`Worker returned ${vectors.length} vectors for ${batch.length} texts`)
      for (const vector of vectors) out.push(Float32Array.from(vector))
    }
    return out
  }

  return {
    get id() {
      return backend === 'local' ? LOCAL_EMBEDDING_ID : HASH_EMBEDDING_ID
    },
    get model() {
      return backend === 'local' ? modelId : HASH_EMBEDDING_MODEL
    },
    get dims() {
      return activeDims
    },
    ready,
    backend: () => backend,
    modelPresent: () => modelFilesPresent(opts.modelsDir, modelId),
    async embed(texts) {
      await ready()
      if (texts.length === 0) return []
      if (backend === 'local') return embedWithWorker(texts)
      return fallback.embed(texts)
    }
  }
}
