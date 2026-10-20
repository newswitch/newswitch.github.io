from typing import Annotated
from fastapi import Depends, FastAPI

app = FastAPI()
events = []

def resource():
    events.append("open")
    try:
        yield object()
    finally:
        events.append("close")

@app.get("/jobs")
def jobs(
    first: Annotated[object, Depends(resource, scope="function")],
    second: Annotated[object, Depends(resource, scope="function")],
):
    events.append("handler")
    return {"same": first is second}

def main():
    from fastapi.testclient import TestClient
    events.clear()
    with TestClient(app) as client:
        print(client.get("/jobs").json())
    print(events)

if __name__ == "__main__":
    main()
