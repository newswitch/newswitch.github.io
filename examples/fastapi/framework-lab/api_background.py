from fastapi import BackgroundTasks, FastAPI

def create_app():
    app = FastAPI()
    app.state.events = []

    def record(job_id):
        app.state.events.append(job_id)

    @app.post("/jobs/{job_id}", status_code=202)
    async def submit(job_id: int, background: BackgroundTasks):
        background.add_task(record, job_id)
        return {"accepted": job_id}

    return app

def main():
    from fastapi.testclient import TestClient
    app = create_app()
    with TestClient(app) as client:
        print(client.post("/jobs/1").status_code)
    print(app.state.events)

if __name__ == "__main__":
    main()
