import { KaError } from '../core/errors'
import type { AIProvider, ChatRequest, ChatResponse, ToolCall } from '../ports'
import { withStructured } from './structured'

/** A canned reply: a full response, a partial one (defaults filled), or a factory. */
export type ScriptedReply = Partial<ChatResponse> | ((req: ChatRequest, index: number) => Partial<ChatResponse> | Error)

/** Scripted provider with access to the recorded calls. */
export interface ScriptedProvider extends AIProvider {
  readonly calls: ChatRequest[]
  push(...replies: ScriptedReply[]): void
  remaining(): number
}

const MODEL = 'scripted'

export function completeResponse(partial: Partial<ChatResponse>): ChatResponse {
  const message = partial.message ?? { role: 'assistant', content: '' }
  return {
    id: partial.id,
    model: partial.model ?? MODEL,
    message,
    finishReason: partial.finishReason ?? (message.tool_calls && message.tool_calls.length > 0 ? 'tool_calls' : 'stop'),
    usage: partial.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 },
    raw: partial.raw
  }
}

export function textResponse(
  content: string,
  finishReason: ChatResponse['finishReason'] = 'stop'
): Partial<ChatResponse> {
  return { message: { role: 'assistant', content }, finishReason }
}

export function jsonResponse(value: unknown): Partial<ChatResponse> {
  return textResponse(JSON.stringify(value))
}

/** Canned tool-call response; `args` may be an object or a raw (possibly broken) string. */
export function toolCallResponse(
  calls: { name: string; args: unknown; id?: string }[],
  content: string | null = null
): Partial<ChatResponse> {
  const toolCalls: ToolCall[] = calls.map((call, index) => ({
    id: call.id ?? `call_${index + 1}`,
    type: 'function',
    function: { name: call.name, arguments: typeof call.args === 'string' ? call.args : JSON.stringify(call.args) }
  }))
  return { message: { role: 'assistant', content, tool_calls: toolCalls }, finishReason: 'tool_calls' }
}

export function createScriptedProvider(replies: ScriptedReply[] = []): ScriptedProvider {
  const queue = [...replies]
  const calls: ChatRequest[] = []

  async function chat(req: ChatRequest): Promise<ChatResponse> {
    calls.push(req)
    const next = queue.shift()
    if (next === undefined) {
      throw new KaError('AI_UNAVAILABLE', 'Scripted provider ran out of replies.', { call: calls.length })
    }
    const reply = typeof next === 'function' ? next(req, calls.length - 1) : next
    if (reply instanceof Error) throw reply
    return completeResponse(reply)
  }

  const base = withStructured({ id: 'scripted', model: MODEL, chat })
  return {
    ...base,
    id: 'scripted',
    model: MODEL,
    calls,
    push: (...more) => {
      queue.push(...more)
    },
    remaining: () => queue.length
  }
}
