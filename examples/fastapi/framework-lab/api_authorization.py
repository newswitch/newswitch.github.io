from fastapi import FastAPI, HTTPException

def create_app():
    app = FastAPI()
    rows = {("tenant-a", 1): {"id": 1, "name": "import"}}

    @app.get("/jobs/{job_id}")
    async def job(job_id: int):
        tenant = "tenant-a"
        row = rows.get((tenant, job_id))
        if row is None:
            raise HTTPException(404, "job not found")
        return row

    return app

def main():
    from fastapi.testclient import TestClient
    with TestClient(create_app()) as client:
        print(client.get("/jobs/1").status_code)
        print(client.get("/jobs/2").status_code)

if __name__ == "__main__":
    main()
