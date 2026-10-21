import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import time

import httpx

from task_service.auth import issue_local


def test_real_api_external_worker_and_stream(tmp_path):
    root = Path(__file__).resolve().parents[1]
    secret = secrets.token_hex(32)
    environment = {**os.environ, "APP_JWT_SECRET": secret,
                   "APP_DATABASE_URL": f"sqlite+aiosqlite:///{tmp_path / 'real.db'}",
                   "PYTHONUTF8": "1"}
    migration = subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"],
                               cwd=root, env=environment, capture_output=True,
                               text=True, timeout=30)
    assert migration.returncode == 0, migration.stdout + migration.stderr
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    process = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "task_service.main:create_from_env", "--factory",
         "--host", "127.0.0.1", "--port", str(port), "--log-level", "error"],
        cwd=root, env=environment, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    try:
        with httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=3,
                           trust_env=False) as client:
            deadline = time.monotonic() + 15
            while True:
                assert process.poll() is None, "server exited during startup"
                try:
                    if client.get("/health/ready").status_code == 200:
                        break
                except httpx.HTTPError:
                    pass
                if time.monotonic() > deadline:
                    raise TimeoutError("startup")
                time.sleep(0.05)
            headers = {"Authorization": "Bearer " + issue_local(secret, "lab"),
                       "Idempotency-Key": "real-one"}
            submitted = client.post("/jobs", json={"name": "import"}, headers=headers)
            assert submitted.status_code == 201
            worker = subprocess.run([sys.executable, "-m", "task_service.cli", "worker", "--once"],
                                    cwd=root, env=environment, capture_output=True,
                                    text=True, timeout=30)
            assert worker.returncode == 0 and '"completed": true' in worker.stdout
            state = client.get(f"/jobs/{submitted.json()['id']}", headers=headers).json()
            assert state["state"] == "done" and state["result"] == "IMPORT"
            with client.stream("GET", "/events?wait=0&limit=1", headers=headers) as response:
                assert response.status_code == 200
                assert next(response.iter_lines()) == "id: 1"
            with client.stream("GET", "/events?wait=5", headers={
                **headers, "Last-Event-ID": "3",
            }) as response:
                assert next(response.iter_lines()) == ": keepalive"
                # Close the real TCP response early rather than consuming the stream.
            assert client.get("/health/ready").status_code == 200
    finally:
        if process.poll() is None:
            process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
        process.stderr.close()
