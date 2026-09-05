# serving-benchmark

Small reproducible load test for comparing LLM serving configurations on one GPU.
Runs a fixed 2,000-request replay set against an OpenAI-compatible endpoint and records
throughput (tokens/s), time-to-first-token and p95 latency.

Files:

- `run_bench.py` — the load generator (asyncio + httpx).
- `config.yaml` — endpoint, concurrency, prompt mix.
- `results.csv` — last run's per-configuration summary.
- `notes.txt` — what changed between runs.
- `prompts.jsonl` — 20 sample prompts from the replay set (the full set is not checked in).
