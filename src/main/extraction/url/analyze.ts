import { isKaError } from '../../core/errors'
import type { ExtractionDeps } from '../types'
import { analyzeHtml, type HtmlAnalysis } from './readable'

/** Worker-call timeout for one page analysis (ms). */
const HTML_WORKER_TIMEOUT_MS = 30_000

/** Metadata + readable article for `html`, in the worker when available. */
export async function runHtmlAnalysis(html: string, url: string, deps: ExtractionDeps): Promise<HtmlAnalysis> {
  if (deps.worker) {
    try {
      return await deps.worker.call<HtmlAnalysis>(
        'extract.html',
        { html, url },
        { timeoutMs: HTML_WORKER_TIMEOUT_MS, ...(deps.signal ? { signal: deps.signal } : {}) }
      )
    } catch (error) {
      if (!(isKaError(error) && error.code === 'NOT_IMPLEMENTED')) throw error
    }
  }
  return analyzeHtml(html, url)
}
