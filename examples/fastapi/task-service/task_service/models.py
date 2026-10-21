import json

from sqlalchemy import Float, ForeignKey, Index, String, Text, UniqueConstraint, update
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Job(Base):
    __tablename__ = "async_jobs"
    __table_args__ = (
        UniqueConstraint("tenant", "idempotency_key", name="uq_async_jobs_tenant_key"),
        Index("ix_async_jobs_claim", "state", "available_at", "lease_until"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant: Mapped[str] = mapped_column(String(80), index=True)
    idempotency_key: Mapped[str] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(80))
    state: Mapped[str] = mapped_column(String(20), default="pending")
    revision: Mapped[int] = mapped_column(default=0)
    attempts: Mapped[int] = mapped_column(default=0)
    available_at: Mapped[float] = mapped_column(Float, default=0)
    lease_until: Mapped[float] = mapped_column(Float, default=0)
    lease_token: Mapped[str | None] = mapped_column(String(32), nullable=True)


class Result(Base):
    __tablename__ = "async_results"
    job_id: Mapped[int] = mapped_column(ForeignKey("async_jobs.id"), primary_key=True)
    value: Mapped[str] = mapped_column(String(320))


class Event(Base):
    __tablename__ = "async_events"
    __table_args__ = (UniqueConstraint("tenant", "sequence", name="uq_async_events_sequence"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant: Mapped[str] = mapped_column(String(80))
    sequence: Mapped[int]
    job_id: Mapped[int] = mapped_column(ForeignKey("async_jobs.id"))
    body: Mapped[str] = mapped_column(Text)


class Stream(Base):
    __tablename__ = "async_streams"
    tenant: Mapped[str] = mapped_column(String(80), primary_key=True)
    sequence: Mapped[int] = mapped_column(default=0)


def job_data(row):
    return {"id": row.id, "name": row.name, "state": row.state,
            "revision": row.revision, "attempts": row.attempts}


async def record_event(db, row):
    # A sequence generated outside a commit-order lock can skip late commits.
    # Hold this per-tenant row lock until the surrounding transaction commits.
    if db.bind.dialect.name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    await db.execute(insert(Stream).values(tenant=row.tenant, sequence=0)
                     .on_conflict_do_nothing(index_elements=[Stream.tenant]))
    sequence = await db.scalar(update(Stream).where(Stream.tenant == row.tenant)
                               .values(sequence=Stream.sequence + 1)
                               .returning(Stream.sequence))
    db.add(Event(tenant=row.tenant, sequence=sequence, job_id=row.id,
                 body=json.dumps(job_data(row), ensure_ascii=False)))
