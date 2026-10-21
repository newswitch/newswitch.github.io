import asyncio
from pathlib import Path
import subprocess
import sys

import httpx
import jwt
import pytest
from datetime import UTC, datetime, timedelta
from fastapi import HTTPException
from sqlalchemy import func, select
from fastapi.testclient import TestClient

from task_service.api import create_app
from task_service.auth import authenticate, issue_local
from task_service.config import Settings
from task_service.database import opened_database
from task_service.models import Base, Event, Result
from task_service.repository import create_job, read_job
from task_service.worker import Worker

KEY = "test-only-secret-not-for-deployment-0123456789"


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
def settings(tmp_path):
    return Settings(database_url=f"sqlite+aiosqlite:///{tmp_path / 'tasks.db'}", jwt_secret=KEY)


@pytest.fixture
async def database(settings):
    async with opened_database(settings.database_url) as database:
        async with database.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        yield database


def headers(tenant="a", permissions=("jobs:read", "jobs:write")):
    return {"Authorization": "Bearer " + issue_local(KEY, tenant, permissions=permissions),
            "Idempotency-Key": "one"}


@pytest.mark.anyio
async def test_worker_claim_finish_and_atomic_event(database):
    row, created = await create_job(database, "a", "one", "import")
    assert created
    worker = Worker(database)
    assert await worker.run_once()
    result = await read_job(database, "a", row["id"])
    assert result["state"] == "done" and result["result"] == "IMPORT"
    assert result["attempts"] == 1
    async with database.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(Result)) == 1
        assert list(await db.scalars(select(Event.sequence).order_by(Event.sequence))) == [1, 2, 3]


@pytest.mark.anyio
async def test_unicode_result_can_expand(database):
    name = "\ufb03" * 80
    row, _ = await create_job(database, "a", "unicode", name)
    assert await Worker(database).run_once()
    result = await read_job(database, "a", row["id"])
    assert result["result"] == "FFI" * 80


@pytest.mark.anyio
async def test_expired_owner_cannot_commit(database):
    row, _ = await create_job(database, "a", "one", "import")
    now = [100.0]
    worker = Worker(database, clock=lambda: now[0], lease_seconds=10)
    stale = await worker.claim()
    assert await worker.claim() is None
    now[0] = 111
    replacement = await worker.claim()
    assert replacement.token != stale.token
    assert not await worker.finish(stale, "STALE")
    assert await worker.finish(replacement, "CURRENT")
    assert not await worker.finish(replacement, "DUPLICATE")
    assert (await read_job(database, "a", row["id"]))["result"] == "CURRENT"


@pytest.mark.anyio
async def test_retry_budget_and_backoff(database):
    await create_job(database, "a", "one", "import")
    now = [100.0]
    worker = Worker(database, clock=lambda: now[0], max_attempts=2)
    first = await worker.claim()
    assert await worker.fail(first)
    assert await worker.claim() is None
    now[0] += 3
    second = await worker.claim()
    assert await worker.fail(second)
    assert (await read_job(database, "a", 1))["state"] == "failed"
    assert await worker.claim() is None


@pytest.mark.anyio
async def test_async_http_lifespan_is_explicit(database, settings):
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                     base_url="http://test") as client:
            first = await client.post("/jobs", json={"name": "import"}, headers=headers())
            assert first.status_code == 201
            assert (await client.post("/jobs", json={"name": "import"},
                                      headers=headers())).status_code == 200
            assert (await client.post("/jobs", json={"name": "other"},
                                      headers=headers())).status_code == 409
            assert (await client.get("/jobs/1", headers=headers("b"))).status_code == 404
            assert (await client.get("/jobs", headers=headers("b"))).json() == []
            assert (await client.delete("/jobs/1?expected_revision=7",
                                        headers=headers())).status_code == 409
            lease = await Worker(database).claim()
            revision = (await client.get("/jobs/1", headers=headers())).json()["revision"]
            assert (await client.delete(f"/jobs/1?expected_revision={revision}",
                                        headers=headers())).status_code == 200
            assert not await Worker(database).finish(lease, "OLD")
            assert (await client.get("/jobs/1", headers=headers())).json()["result"] is None


@pytest.mark.anyio
async def test_stream_replay_and_isolation(database, settings):
    app = create_app(settings)
    await create_job(database, "a", "one", "import")
    await create_job(database, "b", "one", "private")
    await Worker(database).run_once()
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                     base_url="http://test") as client:
            first = await client.get("/events?wait=0&limit=1", headers=headers())
            assert "id: 1" in first.text and "private" not in first.text
            resumed = await client.get("/events?wait=0", headers={**headers(), "Last-Event-ID": "1"})
            assert "id: 2" in resumed.text and "id: 1\n" not in resumed.text
            assert "private" not in resumed.text


@pytest.mark.anyio
async def test_parallel_idempotent_submission(database):
    results = await asyncio.gather(*[
        create_job(database, "a", "same", "import") for _ in range(4)])
    assert sum(created for _, created in results) == 1
    assert {row["id"] for row, _ in results} == {1}


@pytest.mark.anyio
async def test_claim_race(database):
    await create_job(database, "a", "one", "import")
    leases = await asyncio.gather(*[Worker(database).claim() for _ in range(3)])
    assert sum(lease is not None for lease in leases) == 1


@pytest.mark.anyio
async def test_cancellation_cleans_worker_task(database):
    await create_job(database, "a", "one", "import")
    started, cleaned = asyncio.Event(), asyncio.Event()

    async def execute(_):
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            cleaned.set()

    task = asyncio.create_task(Worker(database).run_once(execute))
    await asyncio.wait_for(started.wait(), timeout=2)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert cleaned.is_set()
    assert (await read_job(database, "a", 1))["result"] is None


@pytest.mark.anyio
async def test_crash_at_attempt_limit_becomes_failed(database):
    await create_job(database, "a", "one", "import")
    now = [100.0]
    worker = Worker(database, clock=lambda: now[0], max_attempts=1, lease_seconds=10)
    assert await worker.claim() is not None
    now[0] += 11
    assert await worker.claim() is None
    assert (await read_job(database, "a", 1))["state"] == "failed"


def test_migration_and_api_without_event_loop_sharing(tmp_path, monkeypatch):
    url = f"sqlite+aiosqlite:///{tmp_path / 'migrated.db'}"
    monkeypatch.setenv("APP_DATABASE_URL", url)
    monkeypatch.setenv("APP_JWT_SECRET", KEY)
    root = Path(__file__).resolve().parents[1]
    result = subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"],
                            cwd=root, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stdout + result.stderr
    with TestClient(create_app(Settings())) as client:
        assert client.get("/health/ready").status_code == 200
        assert client.post("/jobs", json={"name": "import"}, headers=headers()).status_code == 201
        assert client.post("/jobs", json={"name": " "}, headers=headers()).status_code == 422
        assert client.get("/jobs/1").status_code == 401
        assert client.get("/jobs", headers=headers(permissions=())).status_code == 403


@pytest.mark.anyio
async def test_heartbeat_extends_only_current_owner(database):
    await create_job(database, "a", "one", "import")
    now = [100.0]
    worker = Worker(database, clock=lambda: now[0], lease_seconds=10)
    lease = await worker.claim()
    now[0] = 108
    assert await worker.heartbeat(lease)
    now[0] = 111
    assert await worker.claim() is None
    now[0] = 119
    assert not await worker.heartbeat(lease)
    assert await worker.claim() is not None


@pytest.mark.anyio
async def test_execution_failure_retries_without_result(database):
    await create_job(database, "a", "one", "import")

    async def broken(_):
        raise ValueError("controlled test failure")

    with pytest.raises(ExceptionGroup):
        await Worker(database).run_once(broken)
    answer = await read_job(database, "a", 1)
    assert answer["state"] == "pending" and answer["attempts"] == 1
    assert answer["result"] is None


@pytest.mark.parametrize("change", [
    {"aud": "another-service"}, {"tenant": ""}, {"permissions": "jobs:write"},
    {"exp": 1}, {"iss": "untrusted"},
])
def test_authentication_rejects_wrong_claims(change):
    now = datetime.now(UTC)
    claims = {"sub": "student", "tenant": "lab", "permissions": ["jobs:read"],
              "iss": "task-lab", "aud": "task-api", "iat": now, "nbf": now,
              "exp": now + timedelta(minutes=1), **change}
    token = jwt.encode(claims, KEY, algorithm="HS256")
    with pytest.raises(HTTPException) as caught:
        authenticate(token, KEY)
    assert caught.value.status_code == 401
