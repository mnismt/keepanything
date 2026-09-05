import type { StructuredSchema, ToolChoice, ToolSpec } from '../../ports'

export const FINISH_TOOL_NAME = 'finish'

/** Build the `finish` tool from a task schema (its JSON Schema becomes the parameters). */
export function finishToolSpec<T>(schema: StructuredSchema<T>, description?: string): ToolSpec {
  return {
    type: 'function',
    function: {
      name: FINISH_TOOL_NAME,
      description:
        description ??
        `End the run and deliver the result (${schema.name ?? 'Result'}). Call this once you have enough information.`,
      parameters: schema.jsonSchema ?? { type: 'object' }
    }
  }
}

/** `tools`/`toolChoice` pair that forces the model to call finish on this step. */
export function forceFinish(finish: ToolSpec): { tools: ToolSpec[]; toolChoice: ToolChoice } {
  return { tools: [finish], toolChoice: 'required' }
}
