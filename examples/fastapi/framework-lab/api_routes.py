from typing import Annotated
from fastapi import FastAPI, HTTPException, Path, Query

app = FastAPI()

@app.get("/jobs/{job_id}")
async def get_job(
    job_id: Annotated[int, Path(ge=1)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
):
    if job_id != 1:
        raise HTTPException(404, "job not found")
    return {"id": job_id, "limit": limit}

def main():
    from fastapi.testclient import TestClient
    with TestClient(app) as client:
        print(client.get("/jobs/1?limit=5").json())
        print(client.get("/jobs/0").status_code)
        print(client.get("/jobs/2").status_code)

if __name__ == "__main__":
    main()
