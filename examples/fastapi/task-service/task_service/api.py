import asyncio
from contextlib import asynccontextmanager
from time import monotonic
from typing import Annotated

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select

from .auth import authenticate, permit
from .database import Database
from .models import Event, Job, job_data
from .repository import cancel_job, create_job, read_job


class CreateJob(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=80)

    @field_validator("name")
    @classmethod
    def normalized_name(cls, value):
        if not value.strip():
            raise ValueError("name must not be blank")
        return value.strip()


def create_app(settings):
    @asynccontextmanager
    async def lifespan(app):
        app.state.database = Database(settings.database_url)
        try:
            yield
        finally:
            await app.state.database.close()

    app = FastAPI(title="Durable task service", lifespan=lifespan)
    bearer = HTTPBearer(auto_error=False)
    router = APIRouter()

    def identity(credentials: Annotated[
        HTTPAuthorizationCredentials | None, Depends(bearer),
    ]):
        return authenticate(credentials.credentials if credentials else "",
                            settings.jwt_secret.get_secret_value())

    @router.post("/jobs", status_code=201)
    async def submit(body: CreateJob, response: Response, user=Depends(identity),
                     key: Annotated[str, Header(alias="Idempotency-Key", min_length=1,
                                                max_length=64)] = ""):
        permit(user, "jobs:write")
        if not key.strip():
            raise HTTPException(400, "provide Idempotency-Key")
        result, created = await create_job(app.state.database, user.tenant, key, body.name)
        response.status_code = 201 if created else 200
        return result

    @router.get("/jobs/{job_id}")
    async def detail(job_id: int, user=Depends(identity)):
        permit(user, "jobs:read")
        return await read_job(app.state.database, user.tenant, job_id)

    @router.get("/jobs")
    async def listing(after: Annotated[int, Query(ge=0)] = 0,
                      limit: Annotated[int, Query(ge=1, le=100)] = 20,
                      user=Depends(identity)):
        permit(user, "jobs:read")
        async with app.state.database.sessions() as db:
            rows = await db.scalars(select(Job).where(
                Job.tenant == user.tenant, Job.id > after).order_by(Job.id).limit(limit))
            return [job_data(row) for row in rows]

    @router.delete("/jobs/{job_id}")
    async def cancel(job_id: int, expected_revision: Annotated[int, Query(ge=0)],
                     user=Depends(identity)):
        permit(user, "jobs:write")
        return await cancel_job(app.state.database, user.tenant, job_id, expected_revision)

    @router.get("/events")
    async def events(request: Request, user=Depends(identity),
                     last_id: Annotated[int, Header(alias="Last-Event-ID", ge=0)] = 0,
                     limit: Annotated[int, Query(ge=1, le=100)] = 10,
                     wait: Annotated[float, Query(ge=0, le=30)] = 5):
        permit(user, "jobs:read")

        async def generate():
            cursor, sent, deadline = last_id, 0, monotonic() + wait
            while True:
                if await request.is_disconnected():
                    return
                async with app.state.database.sessions() as db:
                    records = list(await db.scalars(select(Event).where(
                        Event.tenant == user.tenant, Event.sequence > cursor)
                        .order_by(Event.sequence).limit(min(32, limit - sent))))
                    batch = [(row.sequence, row.body) for row in records]
                # No transaction or Session remains open while the client reads.
                for event_id, body in batch:
                    cursor, sent = event_id, sent + 1
                    yield f"id: {event_id}\nevent: job\ndata: {body}\n\n"
                if sent >= limit or monotonic() >= deadline:
                    return
                if not batch:
                    yield ": keepalive\n\n"
                    await asyncio.sleep(0.1)

        return StreamingResponse(generate(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache",
                                          "X-Accel-Buffering": "no"})

    @app.get("/health/live")
    async def live():
        return {"alive": True}

    @app.get("/health/ready")
    async def ready(response: Response):
        from sqlalchemy.exc import SQLAlchemyError
        try:
            async with app.state.database.sessions() as db:
                await db.execute(select(Job.id).limit(1))
        except SQLAlchemyError:
            response.status_code = 503
            return {"ready": False}
        return {"ready": True}

    app.include_router(router)
    return app
