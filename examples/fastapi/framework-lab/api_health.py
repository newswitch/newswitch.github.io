from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, Response

@asynccontextmanager
async def lifespan(app):
    app.state.ready = True
    try:
        yield
    finally:
        app.state.ready = False

app = FastAPI(lifespan=lifespan)

@app.get("/health/live")
async def live():
    return {"alive": True}

@app.get("/health/ready")
async def ready(request: Request, response: Response):
    value = request.app.state.ready
    if not value:
        response.status_code = 503
    return {"ready": value}

def main():
    from fastapi.testclient import TestClient
    with TestClient(app) as client:
        print(client.get("/health/live").status_code)
        print(client.get("/health/ready").status_code)

if __name__ == "__main__":
    main()
