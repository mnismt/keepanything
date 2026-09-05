# Cheap inference providers — running notes

Working list of places to run open-weight models without owning GPUs. Goal: find the cheapest
option that still gives tool calling + JSON output for the KeepAnything agent, and a fallback
in case the free tier disappears mid-hackathon.

## Candidates

| Provider | What I tried | Notes |
| --- | --- | --- |
| GMI Cloud | `MiniMaxAI/MiniMax-M3` via the OpenAI-compatible `/v1/chat/completions` | Free during MiniMax Week. Tool calling works. Vision works with `image_url` data URIs. `response_format: json_schema` is accepted but not enforced. Occasional 429 "all endpoints overloaded" with `retry-after: 60`. |
| Together AI | Llama 3.3 70B, Qwen | Serverless per-token pricing; good batch API; dedicated endpoints by the hour. |
| Fireworks | Same models, FireFunction for tools | Fast TTFT; grammar-constrained JSON mode is the real deal. |
| DeepInfra | DeepSeek, Qwen | Usually the cheapest per-token price on the board; fewer knobs. |
| Groq | Llama 3.x on LPUs | Very fast tokens/sec; small context; limited model list. |
| Self-host (vLLM) | vLLM on a rented H100 | Only worth it above ~50M tokens/day. PagedAttention paper explains why throughput is so much better than naive HF generate. |

## Decision (for the hackathon)

- Primary: GMI Cloud + MiniMax-M3. Keep `ai` lane concurrency at 1, retry on 429/5xx with jittered backoff.
- Fallback: record/replay cache of every model call so the demo works offline (`KEEPANYTHING_AI=replay`).
- Do not depend on `json_schema` enforcement anywhere: extract the JSON block, validate with zod, retry once with the error.

## Open questions

- How do prices compare once you include prompt caching discounts? (GMI reports `cached_tokens` in usage.)
- Is anyone offering per-request rate-limit headers? So far only `x-gmi-request-id` and Cloudflare headers.

Tags I would have used if this app needed tags: inference, pricing, gpu, llm-serving, hackathon.
