"""Replay a fixed prompt set against an OpenAI-compatible chat endpoint and measure serving metrics."""
import asyncio
import json
import statistics
import time

import httpx
import yaml


async def one(client, cfg, prompt):
    t0 = time.perf_counter()
    first = None
    tokens = 0
    async with client.stream(
        "POST",
        f"{cfg['endpoint']}/chat/completions",
        json={"model": cfg["model"], "messages": [{"role": "user", "content": prompt}], "stream": True, "max_tokens": cfg["max_tokens"]},
    ) as r:
        async for line in r.aiter_lines():
            if not line.startswith("data:") or line.endswith("[DONE]"):
                continue
            if first is None:
                first = time.perf_counter() - t0
            tokens += 1
    return {"ttft": first, "latency": time.perf_counter() - t0, "tokens": tokens}


async def main():
    cfg = yaml.safe_load(open("config.yaml"))
    prompts = [json.loads(l)["prompt"] for l in open("prompts.jsonl")]
    sem = asyncio.Semaphore(cfg["concurrency"])
    async with httpx.AsyncClient(timeout=120) as client:
        async def guarded(p):
            async with sem:
                return await one(client, cfg, p)
        t0 = time.perf_counter()
        results = await asyncio.gather(*(guarded(p) for p in prompts))
        wall = time.perf_counter() - t0
    toks = sum(r["tokens"] for r in results)
    lat = sorted(r["latency"] for r in results)
    print(f"tokens/s={toks / wall:.0f} ttft_p50={statistics.median(r['ttft'] for r in results) * 1000:.0f}ms p95_latency={lat[int(len(lat) * 0.95)]:.2f}s")


if __name__ == "__main__":
    asyncio.run(main())
