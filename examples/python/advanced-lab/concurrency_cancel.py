import asyncio

async def wait_forever(started, cleaned):
    started.set()
    try:
        await asyncio.Event().wait()
    finally:
        cleaned.set()

async def fail_after(started):
    await started.wait()
    raise RuntimeError("broken")

async def main():
    started, cleaned = asyncio.Event(), asyncio.Event()
    try:
        async with asyncio.TaskGroup() as group:
            group.create_task(wait_forever(started, cleaned))
            group.create_task(fail_after(started))
    except* RuntimeError:
        print("failure observed")
    print("cleanup:", cleaned.is_set())
    try:
        async with asyncio.timeout(0.01):
            await asyncio.Event().wait()
    except TimeoutError:
        print("timeout")

if __name__ == "__main__":
    asyncio.run(main())
