from datetime import UTC, datetime, timedelta
from pathlib import Path
import asyncio
import json

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
import jwt
import pytest
from sqlalchemy import create_engine, inspect

import api_database
import api_dependencies
import api_models
import api_routes
import api_source_request
import api_streams
import api_upload
from task_app import create_app

SECRET = b"test-only-key-not-for-production-123456789"


def token(tenant="a", permissions=None, **changes):
    claims = {
        "sub": "user-1", "tenant": tenant,
        "permissions": ["jobs:read", "jobs:write"] if permissions is None else permissions,
        "exp": datetime.now(UTC) + timedelta(minutes=2),
        "iss": "lesson-issuer", "aud": "jobs-api",
    }
    claims.update(changes)
    return jwt.encode(claims, SECRET, algorithm="HS256")


def headers(tenant="a", key="request-1", permissions=None):
    return {"Authorization": "Bearer " + token(tenant, permissions),
            "Idempotency-Key": key}


@pytest.fixture
def database_url(tmp_path):
    return "sqlite:///" + (tmp_path / "tasks.db").as_posix()


@pytest.fixture
def application(database_url):
    return create_app(database_url, SECRET, create_schema=True)


@pytest.fixture
def client(application):
    with TestClient(application) as value:
        yield value


def create(client, **kwargs):
    return client.post("/jobs", json={"name": "import"}, headers=headers(**kwargs))


def test_create_read_and_schema(client):
    response = create(client)
    assert response.status_code == 201
    assert response.json() == {"id": 1, "name": "import", "state": "ready", "revision": 0}
    assert client.get("/jobs/1", headers=headers()).json() == response.json()
    assert "/jobs" in client.get("/openapi.json").json()["paths"]


def test_idempotency_same_body(client):
    first, second = create(client), create(client)
    assert first.status_code == 201
    assert second.status_code == 200
    assert first.json() == second.json()


def test_idempotency_conflict(client):
    create(client)
    response = client.post("/jobs", json={"name": "different"}, headers=headers())
    assert response.status_code == 409


def test_tenant_isolation_in_read_and_cancel(client):
    create(client, tenant="a")
    assert client.get("/jobs/1", headers=headers("b")).status_code == 404
    assert client.delete("/jobs/1", headers=headers("b")).status_code == 404
    other = create(client, tenant="b")
    assert other.status_code == 201
    assert other.json()["id"] != 1


def test_cancel_checks_revision(client):
    create(client)
    assert client.delete("/jobs/1?expected_revision=7", headers=headers()).status_code == 409
    assert client.get("/jobs/1", headers=headers()).json()["state"] == "ready"
    changed = client.delete("/jobs/1", headers=headers())
    assert changed.status_code == 200
    assert changed.json()["revision"] == 1
    assert changed.json()["state"] == "cancelled"
    assert client.delete("/jobs/1", headers=headers()).json() == changed.json()


@pytest.mark.parametrize("name", ["", " ", "x" * 81])
def test_invalid_name(client, name):
    assert client.post("/jobs", json={"name": name}, headers=headers()).status_code == 422


@pytest.mark.parametrize("key", ["", " " * 2, "x" * 65])
def test_invalid_idempotency_key(client, key):
    assert create(client, key=key).status_code == 400


@pytest.mark.parametrize("changes", [
    {"exp": datetime.now(UTC) - timedelta(minutes=2)},
    {"aud": "other"},
    {"iss": "other"},
    {"tenant": 123},
    {"permissions": "*"},
])
def test_invalid_identity(client, changes):
    response = client.get("/jobs/1", headers={"Authorization": "Bearer " + token(**changes)})
    assert response.status_code == 401
    assert response.headers["WWW-Authenticate"] == "Bearer"


def test_missing_and_wrong_key(client):
    assert client.get("/jobs/1").status_code == 401
    bad = jwt.encode({"sub": "x"}, b"a-different-test-key-at-least-32-bytes", algorithm="HS256")
    assert client.get("/jobs/1", headers={"Authorization": "Bearer " + bad}).status_code == 401


def test_permission_and_missing_resource(client):
    create(client)
    assert client.get("/jobs/1", headers=headers(permissions=[])).status_code == 403
    assert client.get("/jobs/99", headers=headers()).status_code == 404


def test_negative_revision(client):
    create(client)
    assert client.delete("/jobs/1?expected_revision=-1", headers=headers()).status_code == 422


def test_ready_and_live_have_different_meanings(client, application):
    assert client.get("/health/ready").status_code == 200
    application.state.ready = False
    assert client.get("/health/ready").status_code == 503
    assert client.get("/health/live").status_code == 200


def test_persistence_across_application_lifetimes(database_url):
    with TestClient(create_app(database_url, SECRET, create_schema=True)) as first:
        create(first)
    with TestClient(create_app(database_url, SECRET)) as second:
        assert second.get("/jobs/1", headers=headers()).json()["name"] == "import"


def test_finite_sse_snapshot_is_tenant_scoped(client):
    create(client, tenant="a")
    response = client.get("/events", headers=headers("b"))
    assert response.status_code == 200
    assert "event: snapshot\ndata: []" in response.text


def test_migration_upgrade_and_downgrade_only_in_tmp_path(tmp_path):
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    url = "sqlite:///" + (tmp_path / "migration.db").as_posix()
    config.set_main_option("sqlalchemy.url", url)
    command.upgrade(config, "head")
    engine = create_engine(url)
    try:
        assert inspect(engine).has_table("jobs")
    finally:
        engine.dispose()
    with TestClient(create_app(url, SECRET)) as migrated:
        assert create(migrated).status_code == 201
    command.downgrade(config, "base")
    engine = create_engine(url)
    try:
        assert not inspect(engine).has_table("jobs")
    finally:
        engine.dispose()


def test_source_exit_stack_order():
    asyncio.run(api_source_request.main())
    assert api_source_request.events == [
        "open-request", "open-function", "handler", "close-function",
        "http.response.start", "http.response.body", "close-request"]


def test_dependency_override_is_restored():
    previous = api_dependencies.app.dependency_overrides.copy()
    try:
        api_dependencies.app.dependency_overrides[api_dependencies.resource] = lambda: "fake"
        with TestClient(api_dependencies.app) as client:
            assert client.get("/jobs").json() == {"same": True}
    finally:
        api_dependencies.app.dependency_overrides.clear()
        api_dependencies.app.dependency_overrides.update(previous)


@pytest.mark.parametrize("size,status", [(0, 200), (5, 200), (1024 * 1024 + 1, 413)])
def test_upload_bounds(size, status):
    with TestClient(api_upload.app) as client:
        response = client.post("/uploads", files={"file": ("data.bin", b"x" * size)})
        assert response.status_code == status


def test_streams_and_websocket():
    with TestClient(api_streams.app) as client:
        assert "data: ready" in client.get("/events").text
        with client.websocket_connect("/ws") as socket:
            socket.send_text("hello")
            assert socket.receive_text() == "HELLO"


@pytest.mark.parametrize("url,status", [
    ("/jobs/1", 200), ("/jobs/0", 422),
    ("/jobs/2", 404), ("/jobs/1?limit=101", 422),
])
def test_route_contract(url, status):
    with TestClient(api_routes.app) as client:
        assert client.get(url).status_code == status


def test_strict_content_type():
    with TestClient(api_database.app) as client:
        assert client.post("/jobs", content=b'{"name":"import"}').status_code == 422


def test_strict_model_rejects_coercion():
    with pytest.raises(ValueError):
        api_models.StrictInput.model_validate({"count": "2"})
