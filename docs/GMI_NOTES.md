# GMI Cloud × MiniMax-M3 probe notes

Measured 3 Sep 2026 with `node scripts/probe/gmi-probe.mjs` (79 requests total: 71 in the main run, 8 in
`followups`) against `POST https://api.gmi-serving.com/v1/chat/completions`, model `MiniMaxAI/MiniMax-M3`,
from Vietnam (Cloudflare edges HKG/SIN). Raw redacted records: `/tmp/gmi-probe-results/<timestamp>/*.json`.
Re-run any group with `node scripts/probe/gmi-probe.mjs <group>`; groups: `baseline json sampling tools vision
long concurrency streaming params followups`. The key is read from `.env` and never printed.

These notes feed `src/main/ai/gmi-minimax.ts` (provider) and `src/main/ai/structured.ts` (JSON extraction).
Assumptions that turned out **wrong** are flagged with ⚠.

## 1. Headline findings

1. **No reasoning is exposed.** In 79/79 responses `message` has only `role` + `content` (+ `tool_calls`).
   No `reasoning_content`, no `reasoning`, no `<think>` tags, and completion tokens ≈ content length / 4.5,
   so no hidden thinking is billed either. A hard logic puzzle was answered correctly in 6 completion tokens.
   None of the thinking-control params (`reasoning_effort`, `thinking`, `enable_thinking`,
   `chat_template_kwargs`, `reasoning`, `/no_think`) changed anything; all were silently accepted.
   ⚠ "keep `reasoning_content` inside a run's transcript" is moot — keep the code path (typed as optional,
   pass-through if present, stripped on persist) but do not design around it.
2. **`response_format` is not enforced.** `json_object` and `json_schema` (strict) are accepted (HTTP 200)
   but when the prompt does not itself ask for JSON, the model returns prose (2/2). When the prompt asks
   for a bare JSON object, output was raw parseable JSON 20/20 across all three modes and all sampling
   settings. Adherence is 100% prompt-driven. One vision call that asked for JSON without saying "no
   fences" came back as ```` ```json ```` fenced. → extract (raw → fenced → first `{`…last `}`) + zod + retry.
3. **Tool calling.** `tool_calls` emitted with `finish_reason: 'tool_calls'`, ids `call_<hex>`,
   `arguments` well-formed JSON 12/12, parallel tool calls (2 in one message) happen naturally with
   `tool_choice: 'auto'`; `parallel_tool_calls: true` accepted. `tool_choice: 'required'` works.
   ⚠ **Named `tool_choice: {type:'function', function:{name:'finish'}}` is ignored** (model called
   `search_library` instead) and **`tool_choice: 'none'` is ignored** (still returned a tool call).
   Forcing the last step works two ways, both verified: send `tools: [finish]` + `tool_choice: 'required'`,
   or append a user message "You have enough information. Call finish now."
4. **Multi-turn tool loops accept any assistant echo.** Assistant messages with `reasoning_content` verbatim,
   omitted, `null`, and `content: null` + `tool_calls` were all accepted (HTTP 200). Omitting
   `reasoning_content` does not break anything. The model likes to search twice before finishing (3/3
   follow-up turns after one search result issued another `search_library`, often 2 in parallel); it
   finished on its own after the second round.
5. **Vision works via `image_url` data URIs** (PNG and JPEG). Image cost ≈ 1.3k–1.9k prompt tokens for
   512–1440 px images, 5.2k for a 4000 px PNG. `detail: 'low'` is accepted but changes nothing. OCR on a
   1440×900 UI screenshot is accurate (read test counts, durations, `$0.27 / 1M tokens`). https image URLs
   are fetched server-side: GitHub raw worked, a Wikimedia URL failed with HTTP 400 `backend_error …
   remote returned status 400 (2013)`. → always send data URIs, never remote URLs.
6. **Long context is fine and fast.** 15.3k prompt tokens (81k chars) answered in 4.3 s with both planted
   needles recalled; 2.5k tokens in 11 s (variance, not size). Tokenizer ≈ 4.9–5.3 chars/token on English prose.
7. **Rate limiting is coarse.** One 429 in 79 requests, *while sequential*: body
   `{"error":{"message":"Service temporarily unavailable. All endpoints are currently overloaded…","type":"service_unavailable","code":"rate_limit_exceeded"}}`
   with header `retry-after: 60`. No `x-ratelimit-*` headers exist. Concurrency 3 and 4 gave 0 × 429 and
   no latency penalty (p50 2.4 s vs 2.2 s sequential). The only useful headers: `x-gmi-request-id`, `cf-ray`.
8. **Truncation is signalled correctly**: `finish_reason: 'length'` with `max_tokens: 64` and `1`.
   `max_tokens: 200000` is accepted (clamped silently). `max_completion_tokens` accepted as an alias.
9. **Prompt caching is on server-side**: `usage.prompt_tokens_details.cached_tokens` reports cache hits on
   identical prefixes (198/199 tokens on repeated system prompts). Keep system prompts byte-stable.
10. **Streaming works** (`stream: true`, SSE `data:` lines, `[DONE]`, `stream_options.include_usage`
    delivers `usage` in-stream, and usage arrives even without it). TTFB ≈ 1.3 s. We do not need it
    ("no streaming for show") but it is available for the Ask answer if latency feels long.

## 2. Measurements

Latency = full round trip from Node (`fetch`) incl. TLS, p50 over successful calls in the group.

| Probe | n | p50 latency | max | prompt tok | completion tok | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| baseline (short Q, 300 max_tokens) | 10 | 2.2 s | 5.4 s | 199 | 81 | 0 reasoning chars; all thinking params no-op |
| json (understand-style, 3 modes × 3) | 9 | 2.5 s | 22.1 s | 419 | 131 | 8/8 raw JSON, keysOk 8/8; 1 × 429 |
| sampling (3 settings × 4) | 12 | 3.3 s | 8.4 s | 419 | 125 | 12/12 parse; see §3 |
| tools (search + finish, parallel) | 9 | 1.8 s | 8.4 s | 794 | 62 | 12/12 args valid JSON; named tool_choice ignored |
| vision (data URI PNG 19 KB–637 KB, https) | 7 | 5.9 s | **46.8 s** | 1 899 | 72 | 1 outlier (first vision call); https wikimedia 400 |
| long 12k chars | 1 | 11.1 s | – | 2 524 | 324 | needles found |
| long 81k chars (~20k tok target) | 1 | 4.3 s | – | 15 324 | 445 | needles found; 5.3 chars/token |
| concurrency 3× / 4× | 7 | 2.4 s | 2.7 s | 199 | 77 | 0 × 429, wall = slowest single call |
| streaming | 2 | 1.8–2.1 s | – | 199 | 72 | TTFB 1.3 s; usage in stream |
| params (13 knobs) | 13 | 2.2 s | 4.9 s | 199 | 76 | everything accepted, see §4 |
| followups | 8 | 2.8 s | 10.3 s | 647 | 96 | see §1 |

Image token cost (prompt tokens minus ~200 text tokens): 512 px PNG ≈ 1 350 · 1200 px ≈ 1 830 · 1440×900 UI
screenshot PNG ≈ 1 700 · 1280 px JPEG ≈ 1 330 · 4000 px PNG ≈ 5 170. The ≤800 px thumbnail rule keeps
images around 1.3–1.5k tokens; JPEG at 1280 px is equally cheap, so snapshots can be sent as-is.

Tail latency: 4 of 79 calls took > 10 s (12 s, 22 s, 46 s, 11 s) with no correlation to size. 60 s timeout is
right; do not lower it. Median calls are 2–3 s, so an `understand` call ≈ 3–6 s incl. an image, an
`organize_batch` run of 6 steps ≈ 15–25 s.

## 3. Sampling

Understand-style JSON prompt, 4 samples per setting (`max_tokens 1200`):

| Setting | parse | schema ok | p50 latency | p50 completion tok | Title variety |
| --- | --- | --- | --- | --- | --- |
| vendor default (no temperature/top_p sent) | 4/4 | 4/4 | 4.9 s | 115 | 2 distinct titles |
| temperature 1.0, top_p 0.95 | 4/4 | 4/4 | 3.3 s | 141 | 2 distinct, longer summaries |
| temperature 0.2 | 4/4 | 4/4 | 2.5 s | 123 | identical every time |

No pass-rate difference at this sample size; 0.2 is shorter and repeatable, 1.0 is wordier. `seed: 7` +
`temperature: 0` was **not** deterministic across two runs (different wording) — do not rely on `seed`.
`temperature: 3` (outside the documented 0–2) accepted without error, so validation is ours.

**Recommendation:** `understand`/`folder` 0.2 (top_p default); `organize*`/`consolidate` 0.2 (tool
selection should be boring); `command` (Ask, briefs, notes) 0.6 so prose is not robotic. Make both
configurable per task in provider config.

## 4. Parameter acceptance

Everything below returned HTTP 200 on this endpoint; nothing was rejected, including garbage:

`temperature` (even 3), `top_p`, `top_k`, `max_tokens` (1 … 200 000), `max_completion_tokens`, `stop`
(string or array), `seed` (accepted, non-deterministic), `n: 2` (accepted, **returns 1 choice**),
`frequency_penalty`, `presence_penalty`, `parallel_tool_calls`, `stream`, `stream_options`,
`response_format` (`json_object`, `json_schema`), `tool_choice` (`auto` | `required` | `none` (ignored) |
named (ignored)), `context_length_exceeded_behavior`, `reasoning_effort`, `thinking`, `enable_thinking`,
`chat_template_kwargs`, `reasoning`, `reasoning_split`, and an unknown `this_param_does_not_exist`.

Consequence: a 200 does not mean a knob works. Validate request shapes in our own code and assert on
response shape (`choices[0].message`, `finish_reason`, `usage`), not on parameter acceptance.

Response shape: `{ id, object, created, model, choices:[{ index, message:{ role, content, tool_calls? }, finish_reason }], usage:{ prompt_tokens, completion_tokens, total_tokens, prompt_tokens_details:{ cached_tokens, cache_write_tokens } } }`.
`content` is `""` (empty string, not null) when only tool calls are returned with `tool_choice: 'required'`,
and a short "I'll search your library…" sentence with `auto`. Errors: JSON `{ error:{ message, type, code, details? } }`.

## 5. Recommendations for `gmi-minimax.ts`

1. **Request builder.** Always send `model`, `messages`, `max_tokens` (≥ 8192 for structured/agentic calls,
   1024 for one-liners), `temperature` per task; send `tools`/`tool_choice` only when tools exist. Do not
   send `response_format` at all (no effect): put the JSON contract in the prompt:
   "Respond with a single JSON object with exactly these keys … Output only the JSON object: no markdown
   fences, no commentary." Send images as `data:` URIs only, ≤ 1280 px, JPEG q82 or PNG.
2. **Retry policy.** 429 and 5xx → up to 3 retries with jittered exponential backoff (2 s, 6 s, 15 s) —
   honour `retry-after` only up to 15 s (GMI says 60 but the outage is transient; the scheduler's job
   backoff 30 s/2 min/10 min handles the long tail). 400 with `backend_error` on an image request →
   do not retry blindly; drop the image and retry once text-only. Network errors/timeouts → retry once.
   Timeout 60 s per call; keep the `AbortSignal` chain.
3. **Response normalisation.** Map `finish_reason` `stop|length|tool_calls` → `FinishReason`, unknown →
   `'unknown'`. `content: ''` → `null` when `tool_calls` present. Pass `reasoning_content` through if it ever
   appears (typed optional), strip on persist/renderer. Log `{task, model, promptTokens, completionTokens,
   cachedTokens, latencyMs, requestId: x-gmi-request-id}`. The request id is the only thing GMI support
   can act on.
4. **Forcing the last step.** Implement "last allowed step forces finish" as `tools: [finishSpec]` +
   `tool_choice: 'required'` (verified), not as named `tool_choice` (ignored). Prose with no tool call →
   re-prompt once with `tool_choice: 'required'` (verified to work). Do not use `tool_choice: 'none'` to get a
   plain-text answer; ask for `finish` instead.
5. **Step budget.** The model tends to issue a second (often parallel) search before finishing. Budget
   ≥ 4 steps for `command` even for trivial questions; run parallel tool calls concurrently (they are
   independent reads) and answer all `tool_call_id`s in order. Per-run token ceiling: with ~800 prompt tokens
   per step on the probe tools, 12 steps ≈ 10–20k prompt tokens. The 60k ceiling is generous.
6. **Prompt caching.** Keep the system prompt and tool definitions byte-identical across calls of the same
   task (cached prefix ≈ free); put per-item content after them. Never interpolate timestamps into the
   system prompt.
7. **Concurrency.** ai lane = 1 is fine for correctness, but 3–4 parallel calls showed no throttling; a
   lane width of 2 (understand calls of a batch in parallel) would halve wall time for a 7-item drop. Keep it
   configurable; default 1 (deterministic ordering in the activity panel), 2 if latency hurts.

## 6. Recommendations for `structured.ts`

- Extraction order in `src/main/ai/structured.ts`: `JSON.parse(trim)` of the whole reply → ```` ``` ```` fence
candidates in **reverse** order with the `json`-tagged one preferred → balanced `{…}` substrings ending
at the last `}`. Strip a leading `<think>…</think>` defensively even though none was observed.
- `finish_reason === 'length'` → do not parse; retry once with `max_tokens × 2` (cap 16k). Observed
  completions for understand-size prompts are 100–450 tokens, so 8k is already 20× headroom; the retry is
  for pathological repetition, not normal output.
- Validation failure → one retry appending the zod error as a user message ("The JSON was invalid: …
  Return the corrected JSON object only."). At 20/20 first-pass success the retry will rarely fire; when it
  does, the most likely cause is a closed-vocabulary miss (`kind` not in `KINDS`), so put the allowed enums verbatim in the prompt and lower-case/trim enum fields before zod.
- Numbers: `confidence` came back as a JSON number every time; still coerce strings.
- Empty content with `finish_reason: 'stop'` was never observed; treat as retryable anyway.

## 7. Embeddings (local MiniLM, `scripts/probe/embed-probe.mjs`)

Files: `build/models/Xenova/all-MiniLM-L6-v2/{config.json, tokenizer.json, tokenizer_config.json,
special_tokens_map.json, onnx/model_quantized.onnx}` — fetched and hash-verified (git-sha1 / LFS sha256 against the
hub tree listing) by `node scripts/fetch-models.mjs` (idempotent, resumable via `.part` + Range, `--verify`,
`--force`). `@huggingface/transformers` 4.2.0, Node 24.18 arm64, `onnxruntime-node` CPU.

Options that worked (offline, no hub access):

```js
import { env, pipeline } from '@huggingface/transformers'
env.allowRemoteModels = false
env.allowLocalModels = true
env.localModelPath = '<dir containing Xenova/all-MiniLM-L6-v2>'   // build/models in dev, <userData>/models packaged
env.useBrowserCache = false
const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8', device: 'cpu', local_files_only: true })
const out = await extractor(texts, { pooling: 'mean', normalize: true })   // out.dims = [n, 384], out.data Float32Array
```

`dtype: 'q8'` maps to `onnx/model_quantized.onnx`. `normalize: true` gives unit vectors (norm 1.0000), so
cosine = dot product, matching the in-memory matrix design.

| Measurement | Value |
| --- | --- |
| Model load (cold process) | 89 ms |
| First call, 3 sentences (includes warm-up) | 9 ms |
| Batch of 32 × ~1 050-char chunks (truncated to 256 wordpieces) | 263–288 ms → **8.2 ms/text** |
| Single ~1 050-char chunk | 10–11 ms |
| Batch of 32 short sentences | 31 ms |
| Sanity cosines | inference↔inference 0.341 · inference↔bread recipe 0.075 |

Implication: embedding a 24-chunk PDF costs ~200 ms; a 7-item drop is < 1 s of embed lane time. The 0.30 cosine
floor is sane for MiniLM (related-but-different sentences land ~0.3–0.5; unrelated < 0.1).

## 8. Open items

- The 46 s vision outlier and the 22 s JSON outlier were single events; measure again during integration
  (log `latencyMs` per task) before tuning timeouts.
- Rate limits were not hit at 4 concurrent short requests; heavier payloads (images) at concurrency were not
  tested. Do not raise the ai lane above 2 without measuring.
- `cached_tokens` accounting suggests a prefix cache with ~128-token granularity; verify that changing only
  the user message keeps the system+tools prefix cached in real runs (it did in the probe).

## 9. Measured in the app, 4 Sep 2026

A driver script against the built app (`KEEPANYTHING_E2E=1 KEEPANYTHING_AI=gmi`, ai lane = 1, MiniLM
seeded), 21 fixture items dropped as two batches (7 + 14), then Ask and a four-item brief. The script
(`scripts/demo/rehearse.mjs`) has since been removed along with the rest of the demo scaffolding; the
numbers below are the measurements it produced and are kept verbatim. Latency is the app's own
`ai.chat` log (`latencyMs`, full round trip incl. retries within one attempt); tokens are `usage` from GMI.
Two runs, 01:09 and 01:16 local (UTC+7), from Vietnam.

| Task | n | p50 | p90 | max | prompt tok (total / avg) | completion tok (total / avg) | cached tok | retries |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| understand (text + vision) | 23 | 13.1 s | 26.0 s | 38.3 s | 83 505 / 3 630 | 11 080 / 482 | 4 827 | 0 |
| organize_batch | 3 | 24.7 s | 24.7 s | 26.3 s | 37 730 (6.8k · 12.8k · 18.1k) | 5 404 (1.2k–2.2k) | 384 | 0 |
| command (Ask + brief, 3 calls each) | 6 | 2.9 s | 7.3 s | 14.5 s | 39 171 / 6 529 | 4 672 / 779 | 20 859 | 0 |
| folder | 1 | 13.6 s | – | – | 1 866 | 361 | 128 | 0 |
| consolidate | 1 | 6.8 s | – | – | 5 293 | 95 | 128 | 0 |
| **total (run 2)** | **34** | | | | **167 565** | **21 612** | **26 326** | **0** |

End-to-end (run 2, verbatim from the transcript):

```
[   0.5s] batch A (seven demo assets): capture:drop 4 files + 3 urls → 7 items in 30ms
[   0.6s] batch B (rest of corpus): capture:drop 7 files + 7 urls → 14 items in 30ms
[ 388.5s]   ai.chat organize_batch   26.3s  prompt=12753 completion=1980 cached=128 finish=stop attempts=1
[ 389.8s]   READY              389.2s  pdf-paged-attention   "Efficient Memory Management for LLM Serving with PagedAttention (vLLM)"
[ 414.0s] settled 21/21 items in 413.4s
[ 434.2s] understanding: 21/21 items have kind + summary + whyUseful + topics
[ 434.2s] relationships: 12/21 items have ≥1 relationship
[ 434.2s] collections: 3
[ 434.6s] search: recall@k 100% (21/21)  MRR 0.97  over 18 queries        (search:quick 5–13 ms, first call 212 ms)
[ 447.7s] Ask "What am I researching here?": succeeded in 13.1s  steps=5 calls=3 prompt=18040 completion=1445
[ 467.9s] Brief (4 items): succeeded in 20.1s  steps=7 calls=3 prompt=21131 completion=3227   (656-word note, 4 sources)
```

Observations that changed or confirmed the notes above:

1. **Understanding is slower than the probe suggested.** Probe p50 was 2–3 s for 400-token prompts; real `understand`
   prompts are 1.8k–6.7k tokens (PDF text, README, screenshot) and answer 200–1 000 tokens, so p50 is **13 s** and
   the tail reaches 38 s. Wall time for 21 items on a single ai lane was 413 s ≈ 20 s/item including the two
   `organize_batch` runs. `ai lane = 2` would roughly halve this (probe showed no throttling at 3–4 concurrent).
2. **Rate limiting hit in run 1.** The first `understand` call timed out at 60 s (`ai.chat.retry … kind:"timeout"`),
   the retry answered in 37.1 s; three minutes later two consecutive `HTTP 429` (delays 1.7 s, 6.3 s) exhausted the
   provider retries and the scheduler parked the job with `AI_UNAVAILABLE`. Run 2, six minutes later, saw **0 retries
   in 34 calls**. The free tier is bursty; budget for it.
   ⚠ Originally, parking set the scheduler's `aiPausedFlag` and nothing but a settings change cleared it;
   the driver script worked around it by calling `settings:update {}`. The scheduler now exposes
   `pauseAi` / `resumeAi` (`src/main/pipeline/scheduler.ts`) and `scheduleAiResume` auto-reopens the lane
   for transient `AI_UNAVAILABLE` / `OFFLINE` errors; only `AI_NOT_CONFIGURED` stays parked until the
   user enters a key.
3. **Prompt caching only covers ~128 tokens of the understand prefix** (`cached_tokens: 128` on 21 of 23 calls; two
   calls hit 1 024/1 115 when a similar README repeated). Within an agentic run caching works as designed: the second
   and third `command` calls reported 2 986 → 6 985 → 7 157 cached tokens, i.e. the whole previous transcript.
   If understand latency matters, move the long, byte-stable instructions to the front of the system prompt.
4. **Tool loops finish quickly.** Ask = 3 calls (1.9 s, 2.9 s, 7.3 s) for 5 steps (`topic_overview`, `list_items`,
   2 × `read_document`, `finish`); the brief = 3 calls (3.2 s, 2.1 s, 14.5 s) for 7 steps ending in a 2.8k-token
   `create_note`. `finish_reason: tool_calls` every time; no prose-without-tool re-prompts were needed.
5. **`organize_batch` on 14 items is an 18k-token prompt** (thin candidates for 80 related things) and still answered
   in 24.7 s with 8 well-formed tool calls in a single response — one call per batch, as designed. The 7-item batch
   issued 12 tool calls in one response (10 relationships + 2 collections), all accepted by the handlers.
6. **Vision on screenshots reads prices and test counts correctly** (`$0.27/M input`, `58 tests passing in 1.42s`),
   consistent with the probe. No `imagesDropped` (400 on an image request) occurred.
7. **No `reasoning_content` and no `<think>` blocks** in any of the 34 + 8 responses.
8. **Output quality.** All 21 items got a specific `kind` and summary (confidence 0.65 for the sampled folder, 0.85–0.97
   elsewhere); the three collections were "Hackathon inference provider research" (4), "LLM serving throughput reading"
   (3) and "KeepAnything build week (Aug 2026)" (8) — specific names, per-member reasons, and the design note was
   correctly left out of the inference collections. Weak spot: the folder understanding ("likely
   containing a model or artifacts") hedges because the folder task only sees the manifest and samples.
