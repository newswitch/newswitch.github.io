from contextvars import ContextVar
from uuid import uuid4
from fastapi import FastAPI

request_id = ContextVar("request_id", default="none")
app = FastAPI()

@app.middleware("http")
async def context(request, call_next):
    identifier = uuid4().hex
    token = request_id.set(identifier)
    try:
        response = await call_next(request)
        response.headers["X-Request-ID"] = identifier
        return response
    finally:
        request_id.reset(token)

@app.get("/jobs")
async def jobs():
    return {"has_context": request_id.get() != "none"}

def main():
    from fastapi.testclient import TestClient
    with TestClient(app) as client:
        response = client.get("/jobs")
        print(response.status_code, response.json())
        print(len(response.headers["X-Request-ID"]) == 32)
    print(request_id.get())

if __name__ == "__main__":
    main()
