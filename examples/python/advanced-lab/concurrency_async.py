import asyncio

async def worker(name, gate):
    await gate.wait()
    return name

async def main():
    gate = asyncio.Event()
    tasks = [asyncio.create_task(worker(name, gate))
             for name in ("a", "b")]
    print("scheduled", len(tasks))
    gate.set()
    print(await asyncio.gather(*tasks))

if __name__ == "__main__":
    asyncio.run(main())
