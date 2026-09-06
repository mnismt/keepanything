/**
 * Utility-process worker entry (`out/main/worker.js`). Spawned lazily by `lib/worker-client.ts`
 * via `utilityProcess.fork`. Runs CPU-heavy work off the main thread: embedding inference, PDF text,
 * readability -> markdown, sha256 of big files. Slices register their tasks in the registry below
 * (`extraction/worker-tasks.ts`, `ai/embeddings/worker-tasks.ts`); this scaffold answers `ping`.
 *
 * No `electron` import here: the utility process only has `process.parentPort`.
 */

import { EMBEDDING_WORKER_TASKS } from '../ai/embeddings/worker-tasks'
import { EXTRACTION_WORKER_TASKS } from '../extraction/worker-tasks'
import { isWorkerRequest, type WorkerResponse, type WorkerTaskRegistry } from './rpc'

/**
 * Task registry: built-ins plus the slices' registries (embeddings: `embed.init`, `embed.texts`,
 * `embed.status`). Frozen names, replaced bodies.
 */
const TASKS: WorkerTaskRegistry = {
  ping: () => 'pong',
  ...EMBEDDING_WORKER_TASKS,
  ...EXTRACTION_WORKER_TASKS
}

const port = process.parentPort

function respond(message: WorkerResponse): void {
  port.postMessage(message)
}

port.on('message', (event) => {
  const request: unknown = event.data
  if (!isWorkerRequest(request)) return

  const handler = TASKS[request.task]
  if (!handler) {
    respond({
      id: request.id,
      ok: false,
      error: { code: 'NOT_IMPLEMENTED', message: `Unknown worker task "${request.task}"` }
    })
    return
  }

  const controller = new AbortController()
  Promise.resolve()
    .then(() => handler(request.payload, controller.signal))
    .then(
      (result) => respond({ id: request.id, ok: true, result }),
      (error: unknown) =>
        respond({
          id: request.id,
          ok: false,
          error: { code: 'INTERNAL', message: error instanceof Error ? error.message : String(error) }
        })
    )
})
