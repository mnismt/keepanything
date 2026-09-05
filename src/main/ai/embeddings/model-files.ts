import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { EMBEDDING_MODEL_ID } from '../../../shared/constants'

/** Files required for `dtype: 'q8'`. */
export const MODEL_FILES: readonly string[] = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'onnx/model_quantized.onnx'
]

export function modelDir(modelsDir: string, modelId: string = EMBEDDING_MODEL_ID): string {
  return join(modelsDir, ...modelId.split('/'))
}

/** Files missing under `modelsDir` for `modelId` (empty when the model is complete). */
export function missingModelFiles(modelsDir: string, modelId: string = EMBEDDING_MODEL_ID): string[] {
  const dir = modelDir(modelsDir, modelId)
  return MODEL_FILES.filter((file) => !existsSync(join(dir, file)))
}

/** True when every required file exists. */
export function modelFilesPresent(modelsDir: string, modelId: string = EMBEDDING_MODEL_ID): boolean {
  return missingModelFiles(modelsDir, modelId).length === 0
}
