/** Uses exactly the options verified by `scripts/probe/embed-probe.mjs`: offline env, `feature-extraction`, `dtype: 'q8'`, `device: 'cpu'`, `local_files_only`, mean pooling + normalize. */
import { EMBEDDING_DIMS, EMBEDDING_MODEL_ID } from '../../../shared/constants'
import { missingModelFiles } from './model-files'

export const EMBED_BATCH_SIZE = 32

export interface MiniLmExtractor {
  readonly modelId: string
  readonly dims: number
  readonly loadMs: number
  /** Normalized vectors as plain arrays (structured-cloneable across the worker port). */
  embed(texts: string[]): Promise<number[][]>
}

interface TensorLike {
  dims: number[]
  data: ArrayLike<number>
}

type Extractor = (texts: string[], opts: { pooling: 'mean'; normalize: boolean }) => Promise<TensorLike>

/** Load the model from `modelsDir` (the directory that contains `Xenova/all-MiniLM-L6-v2`). */
export async function loadMiniLm(modelsDir: string, modelId: string = EMBEDDING_MODEL_ID): Promise<MiniLmExtractor> {
  const missing = missingModelFiles(modelsDir, modelId)
  if (missing.length > 0) {
    throw new Error(`Embedding model files missing under ${modelsDir}: ${missing.join(', ')}`)
  }
  const started = Date.now()
  const transformers = await import('@huggingface/transformers')
  const { env, pipeline } = transformers
  env.allowRemoteModels = false
  env.allowLocalModels = true
  env.localModelPath = modelsDir
  env.useBrowserCache = false
  const extractor = (await pipeline('feature-extraction', modelId, {
    dtype: 'q8',
    device: 'cpu',
    local_files_only: true
  })) as unknown as Extractor
  const loadMs = Date.now() - started

  async function embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = []
    for (let start = 0; start < texts.length; start += EMBED_BATCH_SIZE) {
      const batch = texts.slice(start, start + EMBED_BATCH_SIZE).map((t) => (t.trim().length > 0 ? t : ' '))
      const tensor = await extractor(batch, { pooling: 'mean', normalize: true })
      const [rows = 0, dims = EMBEDDING_DIMS] = tensor.dims
      for (let row = 0; row < rows; row++) {
        const vector = new Array<number>(dims)
        const offset = row * dims
        for (let i = 0; i < dims; i++) vector[i] = Number(tensor.data[offset + i] ?? 0)
        out.push(vector)
      }
    }
    return out
  }

  return { modelId, dims: EMBEDDING_DIMS, loadMs, embed }
}
