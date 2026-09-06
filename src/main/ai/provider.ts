import { AI_PROVIDER_DEFAULTS, AI_PROVIDER_LABEL, COPY } from '../../shared/constants'
import type { AiMode, AiProviderId } from '../../shared/types'
import { KaError } from '../core/errors'
import type { AIProvider, Clock, Logger } from '../ports'
import { createMockProvider } from './mock-provider'
import { createOpenAiCompatibleProvider, type SleepFn } from './openai-compatible'

export interface CreateAiProviderOptions {
  /** Selected OpenAI-compatible provider when `mode` is `gmi` or `openrouter`. */
  provider: AiProviderId
  mode: AiMode
  apiKey?: string | null
  baseUrl?: string
  model?: string
  logger: Logger
  clock?: Clock
  fetchImpl?: typeof fetch
  sleep?: SleepFn
  random?: () => number
  timeoutMs?: number
  /** Per-task temperature overrides. */
  temperatures?: Record<string, number>
}

/** Provider whose every call fails with `AI_NOT_CONFIGURED` (mode `off`, or live without a key/model). */
export function createOffProvider(
  provider: AiProviderId,
  model: string = AI_PROVIDER_DEFAULTS[provider].model,
  message: string = COPY.connectHint
): AIProvider {
  const fail = (): never => {
    throw new KaError('AI_NOT_CONFIGURED', message)
  }
  return {
    id: 'off',
    model,
    chat: async () => fail(),
    generateStructured: async () => fail()
  }
}

/** Build the provider for `mode`. Never throws for missing configuration; returns the `off` provider. */
export function createAiProvider(opts: CreateAiProviderOptions): AIProvider {
  const logger = opts.logger.child({ scope: 'ai' })
  const { provider } = opts
  const fallback = AI_PROVIDER_DEFAULTS[provider]
  const model = opts.model?.trim() || fallback.model
  const baseUrl = opts.baseUrl?.trim() || fallback.baseUrl

  switch (opts.mode) {
    case 'off':
      return createOffProvider(provider, model, 'AI is turned off in Settings.')
    case 'mock':
      return createMockProvider({ logger })
    case 'gmi':
    case 'openrouter': {
      const missing = !opts.apiKey ? 'key' : !model ? 'model' : null
      if (missing) {
        logger.warn('ai.provider.unconfigured', { provider, missing })
        return createOffProvider(
          provider,
          model,
          missing === 'key'
            ? `Add a ${AI_PROVIDER_LABEL[provider]} API key in Settings.`
            : 'Enter a model ID in Settings.'
        )
      }
      return createOpenAiCompatibleProvider({
        provider,
        apiKey: opts.apiKey as string,
        baseUrl,
        model,
        logger,
        clock: opts.clock,
        fetchImpl: opts.fetchImpl,
        sleep: opts.sleep,
        random: opts.random,
        timeoutMs: opts.timeoutMs,
        temperatures: opts.temperatures
      })
    }
    default: {
      const never: never = opts.mode
      throw new KaError('VALIDATION', `Unknown AI mode ${String(never)}`)
    }
  }
}
