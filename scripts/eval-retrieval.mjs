/**
 * Retrieval evaluation harness: runs the hybrid retriever over
 * `tests/fixtures/corpus/eval-queries.json` against a temp library seeded from
 * `tests/fixtures/corpus/manifest.json` and prints recall@k and MRR. The TypeScript sources import
 * `.sql?raw` and extension-less modules, so the eval runs through vitest
 * (`tests/unit/retrieval-eval.test.ts`, skipped unless `KEEPANYTHING_EVAL=1`). Not part of `pnpm test`.
 *
 *   pnpm run eval:retrieval            # local model from build/models when fetched, hash fallback otherwise
 *   pnpm run eval:retrieval -- --hash  # force the hash fallback
 */

import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(new URL('..', import.meta.url).pathname)
const env = { ...process.env, KEEPANYTHING_EVAL: '1' }
if (process.argv.includes('--hash')) env.KEEPANYTHING_EVAL_MODEL = 'hash'

const result = spawnSync(
  process.execPath,
  [resolve(root, 'node_modules/vitest/vitest.mjs'), 'run', 'tests/unit/retrieval-eval.test.ts', '--reporter=dot'],
  { cwd: root, env, stdio: 'inherit' }
)
process.exit(result.status ?? 1)
