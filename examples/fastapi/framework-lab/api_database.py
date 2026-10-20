from contextlib import asynccontextmanager
from typing import Annotated
from fastapi import Depends, FastAPI, Request
from pydantic import BaseModel, Field
from sqlalchemy import String, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column
from sqlalchemy.pool import StaticPool

class Base(DeclarativeBase):
    pass

class Job(Base):
    __tablename__ = "jobs"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80))

class CreateJob(BaseModel):
    name: str = Field(min_length=1, max_length=80)

@asynccontextmanager
async def lifespan(app):
    engine = create_engine("sqlite://", poolclass=StaticPool,
                           connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    app.state.engine = engine
    try:
        yield
    finally:
        engine.dispose()

app = FastAPI(lifespan=lifespan)

def session(request: Request):
    with Session(request.app.state.engine) as value:
        yield value

@app.post("/jobs", status_code=201)
def create_job(body: CreateJob,
               db: Annotated[Session, Depends(session, scope="function")]):
    row = Job(name=body.name)
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "name": row.name}

def main():
    from fastapi.testclient import TestClient
    with TestClient(app) as client:
        response = client.post("/jobs", json={"name": "import"})
        print(response.status_code, response.json())

if __name__ == "__main__":
    main()
