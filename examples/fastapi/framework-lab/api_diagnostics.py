import asyncio
import time

async def main():
    loop = asyncio.get_running_loop()
    callback_ran = asyncio.Event()
    loop.call_soon(callback_ran.set)
    time.sleep(0.02)
    print("while blocked:", callback_ran.is_set())
    await asyncio.sleep(0)
    print("after yield:", callback_ran.is_set())

if __name__ == "__main__":
    asyncio.run(main())
