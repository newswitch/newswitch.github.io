import asyncio
from threading import get_ident
from fastapi import FastAPI

app = FastAPI()

@app.get("/async")
async def asynchronous():
    loop_thread = get_ident()
    worker_thread = await asyncio.to_thread(get_ident)
    return {"different": loop_thread != worker_thread}

@app.get("/sync")
def synchronous():
    return {"ok": True}

def main():
    from fastapi.testclient import TestClient
    with TestClient(app) as client:
        print(client.get("/async").json())
        print(client.get("/sync").json())

if __name__ == "__main__":
    main()
