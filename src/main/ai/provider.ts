import { COPY, DEFAULT_BASE_URL, DEFAULT_MODEL } from '../../shared/constants'
import type { AiMode } from '../../shared/types'
import { KaError } from '../core/errors'
import type { AIProvider, Clock, Logger } from '../ports'
import { createGmiProvider, type SleepFn } from './gmi-minimax'
import { createMockProvider } from './mock-provider'

export interface CreateAiProviderOptions {
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

/** Provider whose every call fails with `AI_NOT_CONFIGURED` (mode `off`, or `gmi` without a key). */
export function createOffProvider(model: string = DEFAULT_MODEL, message: string = COPY.connectHint): AIProvider {
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
  const model = opts.model?.trim() || DEFAULT_MODEL
  const baseUrl = opts.baseUrl?.trim() || DEFAULT_BASE_URL
  const logger = opts.logger.child({ scope: 'ai' })

  const live = (): AIProvider => {
    if (!opts.apiKey) {
      logger.warn('ai.provider.unconfigured', { mode: opts.mode })
      return createOffProvider(model)
    }
    return createGmiProvider({
      apiKey: opts.apiKey,
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

  switch (opts.mode) {
    case 'off':
      return createOffProvider(model, 'AI is turned off in Settings.')
    case 'mock':
      return createMockProvider({ logger })
    case 'gmi':
      return live()
    default: {
      const never: never = opts.mode
      throw new KaError('VALIDATION', `Unknown AI mode ${String(never)}`)
    }
  }
}
