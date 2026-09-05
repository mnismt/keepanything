import { stat } from 'node:fs/promises'
import { z } from 'zod'
import { sha256File } from '../lib/fs'
import type { WorkerTaskRegistry } from '../worker/rpc'
import { extractPdfFile } from './pdf-core'
import { EXTRACTION_BUDGET } from './types'
import { analyzeHtml } from './url/readable'

/**
 * Worker-side tasks owned by extraction, merged into `worker/index.ts`. Heavy libraries (pdf.js,
 * linkedom, readability, turndown) load lazily inside the tasks so `ping` stays instant.
 *
 *   extract.pdf   { path, maxPages?, maxChars? } -> PdfExtraction
 *   extract.html  { html, url }                  -> HtmlAnalysis ({ metadata, readable })
 *   extract.hash  { path }                       -> { sha256, size }
 */

const pdfPayload = z.object({
  path: z.string().min(1),
  maxPages: z.number().int().positive().optional(),
  maxChars: z.number().int().positive().optional()
})
const htmlPayload = z.object({ html: z.string(), url: z.string().min(1) })
const hashPayload = z.object({ path: z.string().min(1) })

/** Build the registry (the worker uses `EXTRACTION_WORKER_TASKS`; tests may build their own). */
export function createExtractionWorkerTasks(): WorkerTaskRegistry {
  return {
    'extract.pdf': async (payload, signal) => {
      const { path, maxPages, maxChars } = pdfPayload.parse(payload)
      return extractPdfFile(path, {
        maxPages: maxPages ?? EXTRACTION_BUDGET.pdfMaxPages,
        maxChars: maxChars ?? EXTRACTION_BUDGET.maxChars,
        signal
      })
    },
    'extract.html': async (payload) => {
      const { html, url } = htmlPayload.parse(payload)
      return analyzeHtml(html, url)
    },
    'extract.hash': async (payload) => {
      const { path } = hashPayload.parse(payload)
      const [sha256, stats] = await Promise.all([sha256File(path), stat(path)])
      return { sha256, size: stats.size }
    }
  }
}

/** The registry `worker/index.ts` merges. */
export const EXTRACTION_WORKER_TASKS: WorkerTaskRegistry = createExtractionWorkerTasks()
