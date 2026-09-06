import { z } from 'zod'
import { EMBEDDING_DIMS, EMBEDDING_MODEL_ID } from '../../../shared/constants'
import type { WorkerTaskRegistry } from '../../worker/rpc'
import { type LocalModelExtractor, loadLocalModel } from './transformers'

const initPayload = z.object({ modelsDir: z.string().min(1), modelId: z.string().min(1).optional() })
const textsPayload = z.object({ texts: z.array(z.string()) })

export interface EmbedStatus {
  loaded: boolean
  modelId: string
  dims: number
  modelsDir: string | null
  loadMs: number | null
}

export interface EmbedInitResult extends EmbedStatus {
  loaded: true
}

interface WorkerState {
  extractor: LocalModelExtractor | null
  modelsDir: string | null
  loading: Promise<LocalModelExtractor> | null
}

/** Build a registry with its own state (the worker uses `EMBEDDING_WORKER_TASKS`; tests build fresh ones). */
export function createEmbeddingWorkerTasks(load: typeof loadLocalModel = loadLocalModel): WorkerTaskRegistry {
  const state: WorkerState = { extractor: null, modelsDir: null, loading: null }

  const status = (): EmbedStatus => ({
    loaded: state.extractor !== null,
    modelId: state.extractor?.modelId ?? EMBEDDING_MODEL_ID,
    dims: state.extractor?.dims ?? EMBEDDING_DIMS,
    modelsDir: state.modelsDir,
    loadMs: state.extractor?.loadMs ?? null
  })

  return {
    'embed.init': async (payload) => {
      const { modelsDir, modelId } = initPayload.parse(payload)
      if (
        state.extractor &&
        state.modelsDir === modelsDir &&
        state.extractor.modelId === (modelId ?? EMBEDDING_MODEL_ID)
      ) {
        return status() as EmbedInitResult
      }
      if (!state.loading) {
        state.loading = load(modelsDir, modelId).then(
          (extractor) => {
            state.extractor = extractor
            state.modelsDir = modelsDir
            state.loading = null
            return extractor
          },
          (error: unknown) => {
            state.loading = null
            throw error
          }
        )
      }
      await state.loading
      return status() as EmbedInitResult
    },
    'embed.texts': async (payload) => {
      const { texts } = textsPayload.parse(payload)
      if (!state.extractor) throw new Error('Embedding model not loaded; call embed.init first.')
      if (texts.length === 0) return []
      return state.extractor.embed(texts)
    },
    'embed.status': () => status()
  }
}

/** The registry `worker/index.ts` merges. */
export const EMBEDDING_WORKER_TASKS: WorkerTaskRegistry = createEmbeddingWorkerTasks()
