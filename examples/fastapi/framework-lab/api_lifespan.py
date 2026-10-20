from contextlib import asynccontextmanager
import httpx
from fastapi import FastAPI, Request

@asynccontextmanager
async def lifespan(app):
    async with httpx.AsyncClient(trust_env=False, timeout=3.0) as client:
        app.state.client = client
        app.state.ready = True
        try:
            yield
        finally:
            app.state.ready = False

app = FastAPI(lifespan=lifespan)

@app.get("/health/ready")
async def ready(request: Request):
    return {"ready": request.app.state.ready}

def main():
    from fastapi.testclient import TestClient
    with TestClient(app) as client:
        print(client.get("/health/ready").json())
        print(app.state.client.is_closed)
    print(app.state.client.is_closed, app.state.ready)

if __name__ == "__main__":
    main()
