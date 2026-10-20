import asyncio
from contextvars import ContextVar

request_id = ContextVar("request_id", default="none")

async def read_after(gate):
    await gate.wait()
    return request_id.get()

def in_thread():
    before = request_id.get()
    request_id.set("thread")
    return before

async def main():
    token = request_id.set("first")
    try:
        gate = asyncio.Event()
        task = asyncio.create_task(read_after(gate))
        request_id.set("second")
        gate.set()
        print(await task)
        print(await asyncio.to_thread(in_thread))
        print(request_id.get())
    finally:
        request_id.reset(token)
    print(request_id.get())

if __name__ == "__main__":
    asyncio.run(main())
