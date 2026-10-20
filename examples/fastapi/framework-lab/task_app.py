"""Integrated teaching service: persistent records, not an external job executor."""
from contextlib import asynccontextmanager
from dataclasses import dataclass
import json
import os
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import jwt
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import String, UniqueConstraint, create_engine, select, update
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column
from sqlalchemy.pool import StaticPool


class Base(DeclarativeBase):
    pass


class Job(Base):
    __tablename__ = "jobs"
    __table_args__ = (UniqueConstraint("tenant", "idempotency_key",
                                     name="uq_jobs_tenant_key"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant: Mapped[str] = mapped_column(String(80))
    idempotency_key: Mapped[str] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(80))
    state: Mapped[str] = mapped_column(String(20), default="ready")
    revision: Mapped[int] = mapped_column(default=0)


class CreateJob(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=80)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value):
        result = value.strip()
        if not result:
            raise ValueError("name must not be blank")
        return result


class JobView(BaseModel):
    id: int
    name: str
    state: str
    revision: int


@dataclass(frozen=True)
class Principal:
    subject: str
    tenant: str
    permissions: frozenset[str]


def view(row):
    return JobView(id=row.id, name=row.name, state=row.state, revision=row.revision)


def permit(identity, permission):
    if permission not in identity.permissions:
        raise HTTPException(403, "operation not permitted")


def create_app(database_url, signing_key, *, create_schema=False):
    if not isinstance(signing_key, bytes) or len(signing_key) < 32:
        raise ValueError("provide at least 32 secret bytes")
    bearer = HTTPBearer(auto_error=False)

    @asynccontextmanager
    async def lifespan(application):
        options = {}
        if database_url.startswith("sqlite"):
            options["connect_args"] = {"check_same_thread": False}
        if database_url == "sqlite://":
            options["poolclass"] = StaticPool
        engine = create_engine(database_url, **options)
        try:
            if create_schema:
                Base.metadata.create_all(engine)
            application.state.engine = engine
            application.state.ready = True
            yield
        finally:
            application.state.ready = False
            engine.dispose()

    application = FastAPI(title="Task records", lifespan=lifespan)

    def identity(
        credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    ):
        failure = HTTPException(401, "invalid credentials",
                                headers={"WWW-Authenticate": "Bearer"})
        if credentials is None:
            raise failure
        try:
            claims = jwt.decode(
                credentials.credentials, signing_key, algorithms=["HS256"],
                issuer="lesson-issuer", audience="jobs-api",
                options={"require": ["sub", "tenant", "permissions", "exp", "iss", "aud"]})
        except jwt.InvalidTokenError:
            raise failure from None
        if (not isinstance(claims["sub"], str) or not claims["sub"]
                or not isinstance(claims["tenant"], str)
                or not 1 <= len(claims["tenant"]) <= 80
                or not isinstance(claims["permissions"], list)
                or not all(isinstance(value, str) for value in claims["permissions"])):
            raise failure
        return Principal(claims["sub"], claims["tenant"], frozenset(claims["permissions"]))

    def session(request: Request):
        with Session(request.app.state.engine) as value:
            yield value

    def find(db, tenant, job_id):
        row = db.scalar(select(Job).where(Job.id == job_id, Job.tenant == tenant))
        if row is None:
            raise HTTPException(404, "job not found")
        return row

    @application.get("/health/live")
    def live():
        return {"alive": True}

    @application.get("/health/ready")
    def ready(request: Request, response: Response):
        try:
            if not request.app.state.ready:
                raise RuntimeError("not ready")
            with Session(request.app.state.engine) as db:
                db.execute(select(Job.id).limit(1))
        except (SQLAlchemyError, RuntimeError):
            response.status_code = 503
            return {"ready": False}
        return {"ready": True}

    @application.post("/jobs", status_code=201, response_model=JobView)
    def create_job(
        body: CreateJob, request: Request, response: Response,
        user: Annotated[Principal, Depends(identity)],
        db: Annotated[Session, Depends(session, scope="function")],
    ):
        permit(user, "jobs:write")
        key = request.headers.get("Idempotency-Key", "")
        if not 1 <= len(key) <= 64 or not key.strip():
            raise HTTPException(400, "provide Idempotency-Key")
        existing = db.scalar(select(Job).where(
            Job.tenant == user.tenant, Job.idempotency_key == key))
        if existing is None:
            row = Job(tenant=user.tenant, idempotency_key=key, name=body.name)
            db.add(row)
            try:
                db.commit()
                db.refresh(row)
                return view(row)
            except IntegrityError:
                db.rollback()
                existing = db.scalar(select(Job).where(
                    Job.tenant == user.tenant, Job.idempotency_key == key))
        if existing is None or existing.name != body.name:
            raise HTTPException(409, "idempotency conflict")
        response.status_code = 200
        return view(existing)

    @application.get("/jobs/{job_id}", response_model=JobView)
    def read_job(
        job_id: int, user: Annotated[Principal, Depends(identity)],
        db: Annotated[Session, Depends(session, scope="function")],
    ):
        permit(user, "jobs:read")
        return view(find(db, user.tenant, job_id))

    @application.delete("/jobs/{job_id}", response_model=JobView)
    def cancel_job(
        job_id: int, user: Annotated[Principal, Depends(identity)],
        db: Annotated[Session, Depends(session, scope="function")],
        expected_revision: Annotated[int, Query(ge=0)] = 0,
    ):
        permit(user, "jobs:write")
        row = find(db, user.tenant, job_id)
        if row.state == "cancelled":
            return view(row)
        changed = db.execute(update(Job).where(
            Job.id == job_id, Job.tenant == user.tenant,
            Job.state == "ready", Job.revision == expected_revision,
        ).values(state="cancelled", revision=Job.revision + 1))
        if changed.rowcount != 1:
            db.rollback()
            raise HTTPException(409, "revision conflict")
        db.commit()
        return view(find(db, user.tenant, job_id))

    @application.get("/events")
    def events(
        user: Annotated[Principal, Depends(identity)],
        db: Annotated[Session, Depends(session, scope="function")],
    ):
        permit(user, "jobs:read")
        snapshot = [view(row).model_dump() for row in db.scalars(
            select(Job).where(Job.tenant == user.tenant).order_by(Job.id).limit(100))]
        body = "event: snapshot\ndata: " + json.dumps(snapshot) + "\n\n"
        return StreamingResponse(iter([body]), media_type="text/event-stream")

    return application


def create_from_env():
    """Production-shaped entry: explicit configuration and migrations required."""
    return create_app(os.environ["APP_DATABASE_URL"],
                      os.environ["LAB_JWT_SECRET"].encode("utf-8"))
