from fastapi import FastAPI

def create_app():
    application = FastAPI(title="Task service")

    @application.get("/health/live")
    async def live():
        return {"status": "alive"}

    @application.get("/jobs/{job_id}")
    async def get_job(job_id: int):
        return {"id": job_id, "state": "ready"}

    return application

app = create_app()

def main():
    from fastapi.testclient import TestClient
    with TestClient(app) as client:
        response = client.get("/jobs/1")
        print(response.status_code, response.json())

if __name__ == "__main__":
    main()
