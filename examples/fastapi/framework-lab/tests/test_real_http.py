"""Real loopback HTTP, with an explicitly owned and bounded Uvicorn process."""
from contextlib import contextmanager
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
from time import monotonic, sleep

import httpx
import pytest
from load_probe import probe


@contextmanager
def server():
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    # The close/bind interval may race. Startup failure is a failed test,
    # never a reason to stop an unrelated process occupying this port.
    environment = {**os.environ, "PYTHONUTF8": "1", "PYTHONDONTWRITEBYTECODE": "1"}
    with tempfile.TemporaryFile(mode="w+b") as output:
        process = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "api_health:app", "--host", "127.0.0.1",
             "--port", str(port), "--no-access-log", "--log-level", "warning"],
            cwd=Path(__file__).resolve().parents[1], env=environment,
            stdout=output, stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        base = f"http://127.0.0.1:{port}"
        try:
            deadline = monotonic() + 15
            with httpx.Client(timeout=0.3, trust_env=False) as client:
                while monotonic() < deadline:
                    if process.poll() is not None:
                        output.seek(0)
                        raise AssertionError(output.read().decode("utf-8", errors="replace"))
                    try:
                        if client.get(base + "/health/ready").status_code == 200:
                            break
                    except httpx.TransportError:
                        pass
                    sleep(0.05)
                else:
                    raise AssertionError("Owned Uvicorn did not become ready")
            yield base
        finally:
            # Only this Popen handle is eligible for termination.
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)


def test_real_http_process_and_openapi():
    with server() as base, httpx.Client(timeout=3.0, trust_env=False) as client:
        assert client.get(base + "/health/live").json() == {"alive": True}
        assert client.get(base + "/health/ready").status_code == 200
        assert "/health/live" in client.get(base + "/openapi.json").json()["paths"]


def test_bounded_real_http_probe():
    with server() as base:
        result = probe(base + "/health/live", requests=12, concurrency=2)
    assert result["completed"] == 12
    assert result["requests_per_second"] > 0
    assert 0 <= result["p50_seconds"] <= result["p99_seconds"]


@pytest.mark.parametrize("requests,concurrency", [(0, 2), (10, 0), (10001, 1), (1, 33)])
def test_probe_rejects_unbounded_configuration(requests, concurrency):
    with pytest.raises(ValueError):
        probe("http://127.0.0.1:1", requests, concurrency)
