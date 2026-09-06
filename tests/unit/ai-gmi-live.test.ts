/**
 * One real structured call against GMI, only when `KEEPANYTHING_GMI_API_KEY` is set in the
 * environment. The key is read here (tests may read env; app code may not) and never logged.
 */

import { describe, expect, it } from 'vitest'
import { createOpenAiCompatibleProvider } from '../../src/main/ai/openai-compatible'
import { buildUnderstandRequest } from '../../src/main/ai/prompts'
import { understandingSchema } from '../../src/main/ai/schemas'
import type { Logger } from '../../src/main/ports'

const apiKey = process.env.KEEPANYTHING_GMI_API_KEY
const baseUrl = process.env.KEEPANYTHING_GMI_BASE_URL
const model = process.env.KEEPANYTHING_MODEL

const lines: string[] = []
const logger: Logger = {
  debug() {},
  info: (msg, fields) => lines.push(JSON.stringify({ msg, fields })),
  warn: (msg, fields) => lines.push(JSON.stringify({ msg, fields })),
  error: (msg, fields) => lines.push(JSON.stringify({ msg, fields })),
  child: () => logger
}

describe.skipIf(!apiKey)('GMI live (gated on KEEPANYTHING_GMI_API_KEY)', () => {
  it('understands a short item with one structured call', async () => {
    const provider = createOpenAiCompatibleProvider({
      provider: 'gmi',
      apiKey: apiKey as string,
      baseUrl,
      model,
      logger
    })
    const req = buildUnderstandRequest({
      title: 'Rectangle: Move and resize windows on macOS with keyboard shortcuts and snap areas',
      type: 'url',
      subtype: 'github_repo',
      url: 'https://github.com/rxhanson/Rectangle',
      domain: 'github.com',
      text: 'Rectangle is a window management app based on Spectacle, written in Swift. Install with brew install --cask rectangle.'
    })
    const { value, usage } = await provider.generateStructured(understandingSchema, { ...req, maxTokens: 1200 })
    expect(value.title.length).toBeGreaterThan(0)
    expect(['macos_app', 'cli_tool', 'library', 'other']).toContain(value.kind)
    expect(value.retrievalHints.length).toBeGreaterThanOrEqual(1)
    expect(usage.promptTokens).toBeGreaterThan(0)
    // Latency only; never the key or prompt.
    console.log(`gmi live understand: ${usage.latencyMs} ms, ${usage.promptTokens}+${usage.completionTokens} tokens`)
    expect(lines.join('\n')).not.toContain(apiKey as string)
  }, 90_000)
})
