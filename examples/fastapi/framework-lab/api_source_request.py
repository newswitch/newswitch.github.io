import asyncio
from typing import Annotated
from fastapi import Depends, FastAPI

events = []
app = FastAPI()

def request_resource():
    events.append("open-request")
    try:
        yield object()
    finally:
        events.append("close-request")

def function_resource():
    events.append("open-function")
    try:
        yield object()
    finally:
        events.append("close-function")

@app.get("/jobs")
async def jobs(
    first: Annotated[object, Depends(request_resource, scope="request")],
    second: Annotated[object, Depends(function_resource, scope="function")],
):
    events.append("handler")
    return {"ok": True}

async def main():
    events.clear()
    scope = {"type": "http", "asgi": {"version": "3.0"},
             "http_version": "1.1", "method": "GET", "scheme": "http",
             "path": "/jobs", "raw_path": b"/jobs", "query_string": b"",
             "root_path": "", "headers": [], "server": ("test", 80),
             "client": ("test", 1)}

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        events.append(message["type"])

    await app(scope, receive, send)
    print(events)

if __name__ == "__main__":
    asyncio.run(main())
