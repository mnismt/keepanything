/** Uses exactly the options verified by `scripts/probe/embed-probe.mjs`: offline env, `feature-extraction`, `dtype: 'q8'`, `device: 'cpu'`, `local_files_only`, normalize. Pooling is `cls`, the BAAI recommendation for bge. */
import { EMBEDDING_MODEL_ID } from '../../../shared/constants'
import { missingModelFiles } from './model-files'

export const EMBED_BATCH_SIZE = 32

export interface LocalModelExtractor {
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

type Pooling = 'cls' | 'mean'
type Extractor = (texts: string[], opts: { pooling: Pooling; normalize: boolean }) => Promise<TensorLike>

/** Load the model from `modelsDir` (the directory that contains the `EMBEDDING_MODEL_ID` folder). */
export async function loadLocalModel(
  modelsDir: string,
  modelId: string = EMBEDDING_MODEL_ID,
  pooling: Pooling = 'cls'
): Promise<LocalModelExtractor> {
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
  // One warm-up call: it fixes `dims` before any caller stores a row (rows are decoded with their
  // `dims` column, so 0 would silently drop them from the index) and pays the ONNX session cost here.
  const [, dims = 0] = (await extractor([' '], { pooling, normalize: true })).dims
  if (dims <= 0) throw new Error(`Embedding model ${modelId} returned an empty vector`)
  const loadMs = Date.now() - started

  async function embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = []
    for (let start = 0; start < texts.length; start += EMBED_BATCH_SIZE) {
      const batch = texts.slice(start, start + EMBED_BATCH_SIZE).map((t) => (t.trim().length > 0 ? t : ' '))
      const tensor = await extractor(batch, { pooling, normalize: true })
      const [rows = 0, d = 0] = tensor.dims
      if (d !== dims) throw new Error(`Embedding model ${modelId} returned ${d}-d vectors, expected ${dims}`)
      for (let row = 0; row < rows; row++) {
        const vector = new Array<number>(d)
        const offset = row * d
        for (let i = 0; i < d; i++) vector[i] = Number(tensor.data[offset + i] ?? 0)
        out.push(vector)
      }
    }
    return out
  }

  return { modelId, dims, loadMs, embed }
}
