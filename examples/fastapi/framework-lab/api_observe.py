from collections import Counter
from time import monotonic
from fastapi import FastAPI

app = FastAPI()
counts = Counter()

@app.middleware("http")
async def observe(request, call_next):
    started = monotonic()
    response = await call_next(request)
    route = request.scope.get("route")
    pattern = getattr(route, "path", "unmatched")
    counts[(pattern, response.status_code)] += 1
    response.headers["X-Elapsed-Nonnegative"] = str(monotonic() >= started)
    return response

@app.get("/jobs/{job_id}")
async def job(job_id: int):
    return {"id": job_id}

def main():
    from fastapi.testclient import TestClient
    counts.clear()
    with TestClient(app) as client:
        client.get("/jobs/1")
        result = client.get("/jobs/2")
    print(dict(counts))
    print(result.headers["X-Elapsed-Nonnegative"])

if __name__ == "__main__":
    main()
