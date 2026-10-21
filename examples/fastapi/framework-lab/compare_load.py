import json
from pathlib import Path
import platform
import socket
import subprocess
import sys
import time

import httpx
from load_probe import probe


def main():
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    process = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "api_bottlenecks:app", "--host", "127.0.0.1",
         "--port", str(port), "--log-level", "error"], cwd=Path(__file__).parent,
        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
    )
    base = f"http://127.0.0.1:{port}"
    try:
        deadline = time.monotonic() + 15
        with httpx.Client(timeout=0.5, trust_env=False) as client:
            while True:
                if process.poll() is not None:
                    raise RuntimeError(process.stderr.read().decode(errors="replace"))
                try:
                    if client.get(base + "/health/live").status_code == 200:
                        break
                except httpx.HTTPError:
                    pass
                if time.monotonic() > deadline:
                    raise TimeoutError("server startup")
                time.sleep(0.05)
        results = []
        for concurrency in (1, 4):
            for route in ("blocking", "threaded", "asynchronous"):
                results.append({"route": route, "concurrency": concurrency,
                                **probe(base + "/" + route + "?delay=0.02", 20, concurrency)})
        print(json.dumps({"platform": platform.platform(), "python": platform.python_version(),
                          "workers": 1, "requests_per_case": 20, "results": results}, indent=2))
    finally:
        if process.poll() is None:
            process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
        process.stderr.close()


if __name__ == "__main__":
    main()
