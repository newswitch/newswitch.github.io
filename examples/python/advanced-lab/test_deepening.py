import asyncio
from contextlib import asynccontextmanager, AsyncExitStack
import subprocess
import sys
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from descriptor_detail import Endpoint, Port
from race_detail import lost_update, protected_update


@pytest.fixture
def anyio_backend():
    return "asyncio"


def test_descriptor_instance_storage():
    first, second = Endpoint(80), Endpoint(443)
    first.__dict__["port"] = 0
    assert first.port == 80 and second.port == 443
    assert isinstance(Endpoint.port, Port)


@pytest.mark.parametrize("value", [True, 0, 65536, "80"])
def test_descriptor_rejects_invalid(value):
    with pytest.raises(ValueError):
        Endpoint(value)


def test_deliberate_race_and_fix():
    assert lost_update() == 1
    assert protected_update() == 2


@pytest.mark.anyio
async def test_async_mock_success_and_error():
    fetch = AsyncMock(side_effect=[{"state": "ready"}, TimeoutError("budget")])
    assert (await fetch("one"))["state"] == "ready"
    with pytest.raises(TimeoutError):
        await fetch("two")
    assert fetch.await_count == 2
    fetch.assert_awaited_with("two")


@pytest.mark.anyio
async def test_cancel_waits_for_resource_cleanup():
    opened, cleaned = asyncio.Event(), asyncio.Event()

    @asynccontextmanager
    async def resource():
        opened.set()
        try:
            yield
        finally:
            await asyncio.sleep(0)
            cleaned.set()

    async def use():
        async with AsyncExitStack() as stack:
            await stack.enter_async_context(resource())
            await asyncio.Event().wait()

    task = asyncio.create_task(use())
    await asyncio.wait_for(opened.wait(), timeout=2)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert cleaned.is_set()


def test_static_contracts():
    directory = Path(__file__).parent
    good = subprocess.run(
        [sys.executable, "-m", "mypy", "--strict", "--no-incremental", "typing_good.py"],
        cwd=directory, text=True, capture_output=True, timeout=45,
    )
    assert good.returncode == 0, good.stdout + good.stderr
    bad = subprocess.run(
        [sys.executable, "-m", "mypy", "--strict", "--no-incremental", "typing_bad.py"],
        cwd=directory, text=True, capture_output=True, timeout=45,
    )
    assert bad.returncode == 1 and bad.stdout.count("error:") == 2, bad.stdout
