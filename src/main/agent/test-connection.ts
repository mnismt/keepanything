import type { TestConnectionResult } from '../../shared/ipc'
import { isKaError } from '../core/errors'
import type { AIProvider } from '../ports'

/** Probe the provider. Never throws. */
export async function testConnection(
  provider: AIProvider,
  opts: { timeoutMs?: number; now?: () => number } = {}
): Promise<TestConnectionResult> {
  const now = opts.now ?? Date.now
  const started = now()
  try {
    const response = await provider.chat({
      messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
      maxTokens: 16,
      timeoutMs: opts.timeoutMs ?? 20_000,
      task: 'test_connection'
    })
    return { ok: true, model: response.model, latencyMs: now() - started }
  } catch (error) {
    return {
      ok: false,
      model: provider.model,
      latencyMs: now() - started,
      error: isKaError(error) ? error.message : "Couldn't reach the provider."
    }
  }
}
