from importlib.metadata import version
from typing import Annotated
from fastapi import APIRouter, Depends, FastAPI

router = APIRouter(prefix="/jobs")

def limit():
    return 10

@router.get("/{job_id}")
def job(job_id: int, maximum: Annotated[int, Depends(limit)]):
    return {"id": job_id, "limit": maximum}

app = FastAPI()
app.include_router(router)

def main():
    route = router.routes[0]
    print(version("fastapi"))
    print(route.dependant.call is job)
    print(route.dependant.dependencies[0].call is limit)
    print("/jobs/{job_id}" in app.openapi()["paths"])

if __name__ == "__main__":
    main()
