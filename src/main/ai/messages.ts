import type {
  AssistantMessage,
  ChatMessage,
  ContentPart,
  SystemMessage,
  ToolCall,
  ToolMessage,
  UserMessage
} from '../ports'

export function systemMessage(content: string): SystemMessage {
  return { role: 'system', content }
}

export function userMessage(content: string | ContentPart[]): UserMessage {
  return { role: 'user', content }
}

export function textPart(text: string): ContentPart {
  return { type: 'text', text }
}

/** Build an image part from a `data:` URI (never a remote URL). */
export function imagePart(dataUri: string, detail?: 'low' | 'high' | 'auto'): ContentPart {
  return { type: 'image_url', image_url: detail ? { url: dataUri, detail } : { url: dataUri } }
}

/** Build an assistant message (optionally echoing tool calls back in a transcript). */
export function assistantMessage(content: string | null, toolCalls?: ToolCall[]): AssistantMessage {
  return toolCalls && toolCalls.length > 0
    ? { role: 'assistant', content, tool_calls: toolCalls }
    : { role: 'assistant', content }
}

export function toolMessage(toolCallId: string, content: string): ToolMessage {
  return { role: 'tool', tool_call_id: toolCallId, content }
}

/** Approximate prompt tokens an image part costs (1.3k–1.9k for ≤ 1440 px). */
export const IMAGE_TOKEN_ESTIMATE = 1_600

/** Rough token estimate: chars / 4 for text, a flat cost per image. */
export function estimateTokens(input: string | ChatMessage[]): number {
  if (typeof input === 'string') return Math.ceil(input.length / 4)
  let total = 0
  for (const message of input) {
    total += 4 // role + separators
    if (message.role === 'user' && Array.isArray(message.content)) {
      for (const part of message.content) {
        total += part.type === 'text' ? Math.ceil(part.text.length / 4) : IMAGE_TOKEN_ESTIMATE
      }
      continue
    }
    if (typeof message.content === 'string') total += Math.ceil(message.content.length / 4)
    if (message.role === 'assistant' && message.tool_calls) {
      for (const call of message.tool_calls) {
        total += Math.ceil((call.function.name.length + call.function.arguments.length) / 4) + 8
      }
    }
  }
  return total
}

/** Text of a message with image parts omitted. */
export function messageText(message: ChatMessage): string {
  if (typeof message.content === 'string') return message.content
  if (message.content === null) return ''
  return message.content
    .filter((part): part is Extract<ContentPart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
}

/** Index of the last user message, or -1. */
export function lastUserIndex(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') return i
  }
  return -1
}

/**
 * Return a copy of `messages` with `text` appended to the last user message (as a new text part for
 * multimodal messages). When there is no user message, one is appended.
 */
export function appendToLastUserMessage(messages: ChatMessage[], text: string): ChatMessage[] {
  const index = lastUserIndex(messages)
  if (index === -1) return [...messages, userMessage(text)]
  const target = messages[index] as UserMessage
  const updated: UserMessage =
    typeof target.content === 'string'
      ? { role: 'user', content: `${target.content}\n\n${text}` }
      : { role: 'user', content: [...target.content, textPart(text)] }
  return messages.map((message, i) => (i === index ? updated : message))
}

/** True when any user message carries an image part. */
export function hasImages(messages: ChatMessage[]): boolean {
  return messages.some(
    (message) =>
      message.role === 'user' &&
      Array.isArray(message.content) &&
      message.content.some((part) => part.type === 'image_url')
  )
}

/** Copy of `messages` with image parts removed (text-only fallback after an image 400). */
export function stripImageParts(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => {
    if (message.role !== 'user' || !Array.isArray(message.content)) return message
    const text = message.content.filter((part) => part.type === 'text')
    const content = text.length > 0 ? text : [textPart('(image omitted)')]
    return { role: 'user', content }
  })
}

const DATA_URI = /data:([\w.+-]+\/[\w.+-]+)?(;[\w=-]+)*;base64,[A-Za-z0-9+/=_-]+/g

/** Replace base64 `data:` URIs by a short placeholder (`data:image/png;base64,<12345 bytes>`). */
export function redactDataUris(text: string): string {
  return text.replace(DATA_URI, (match, mime: string | undefined) => {
    const payload = match.slice(match.indexOf(',') + 1)
    return `data:${mime ?? 'application/octet-stream'};base64,<${payload.length} chars>`
  })
}

/** Deep copy of `messages` safe for logs: data URIs redacted, text truncated to `maxChars`. */
export function messagesForLog(messages: ChatMessage[], maxChars = 400): unknown[] {
  const clip = (text: string): string => {
    const redacted = redactDataUris(text)
    return redacted.length > maxChars ? `${redacted.slice(0, maxChars)}…(${redacted.length} chars)` : redacted
  }
  return messages.map((message) => {
    if (message.role === 'user' && Array.isArray(message.content)) {
      return {
        role: 'user',
        content: message.content.map((part) =>
          part.type === 'text'
            ? { type: 'text', text: clip(part.text) }
            : { type: 'image_url', url: clip(part.image_url.url) }
        )
      }
    }
    if (message.role === 'assistant') {
      return {
        role: 'assistant',
        content: message.content === null ? null : clip(message.content),
        toolCalls: message.tool_calls?.map((call) => ({
          name: call.function.name,
          arguments: clip(call.function.arguments)
        }))
      }
    }
    return { role: message.role, content: clip(messageText(message)) }
  })
}

const THINK_BLOCK = /<think>[\s\S]*?<\/think>/gi
const UNCLOSED_THINK = /<think>[\s\S]*$/i

/** Remove `<think>...</think>` blocks (never observed on GMI, kept defensively). */
export function stripThink(text: string): string {
  return text.replace(THINK_BLOCK, '').trim()
}

/** True when the text has an opening `<think>` with no closing tag (truncated reasoning). */
export function hasUnclosedThink(text: string): boolean {
  return UNCLOSED_THINK.test(text.replace(THINK_BLOCK, ''))
}
