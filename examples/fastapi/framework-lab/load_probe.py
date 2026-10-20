"""Bounded closed-loop probe for a service the operator explicitly selects."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from math import ceil
from time import monotonic
import httpx

def probe(url, requests, concurrency):
    if not 1 <= requests <= 10000 or not 1 <= concurrency <= 32:
        raise ValueError("requests 1..10000, concurrency 1..32")
    with httpx.Client(timeout=3.0, trust_env=False,
                      limits=httpx.Limits(max_connections=concurrency)) as client:
        def one(_):
            start = monotonic()
            response = client.get(url)
            response.raise_for_status()
            return monotonic() - start
        started = monotonic()
        with ThreadPoolExecutor(max_workers=concurrency) as pool:
            values = sorted(pool.map(one, range(requests), buffersize=concurrency))
    elapsed = monotonic() - started
    return {"completed": len(values), "elapsed_seconds": elapsed,
            "requests_per_second": len(values) / elapsed,
            "p50_seconds": values[ceil(len(values) * 0.50) - 1],
            "p99_seconds": values[ceil(len(values) * 0.99) - 1]}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--requests", type=int, default=20)
    parser.add_argument("--concurrency", type=int, default=2)
    arguments = parser.parse_args()
    print(probe(arguments.url, arguments.requests, arguments.concurrency))

if __name__ == "__main__":
    main()
