from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from fastapi import HTTPException

from .models import Job, Result, job_data, record_event


async def create_job(database, tenant, key, name):
    try:
        async with database.sessions.begin() as db:
            existing = await db.scalar(select(Job).where(
                Job.tenant == tenant, Job.idempotency_key == key))
            if existing is not None:
                if existing.name != name:
                    raise HTTPException(409, "idempotency conflict")
                return job_data(existing), False
            row = Job(tenant=tenant, idempotency_key=key, name=name)
            db.add(row)
            await db.flush()
            await record_event(db, row)
            result = job_data(row)
        return result, True
    except IntegrityError:
        # The failed transaction is already rolled back. Re-read in a new one.
        async with database.sessions() as db:
            existing = await db.scalar(select(Job).where(
                Job.tenant == tenant, Job.idempotency_key == key))
            if existing is None:
                raise
            if existing.name != name:
                raise HTTPException(409, "idempotency conflict") from None
            return job_data(existing), False


async def read_job(database, tenant, job_id):
    async with database.sessions() as db:
        row = await db.scalar(select(Job).where(Job.id == job_id, Job.tenant == tenant))
        if row is None:
            raise HTTPException(404, "job not found")
        answer = job_data(row)
        result = await db.get(Result, row.id)
        answer["result"] = result.value if result is not None else None
        return answer


async def cancel_job(database, tenant, job_id, revision):
    async with database.sessions.begin() as db:
        changed = await db.execute(update(Job).where(
            Job.id == job_id, Job.tenant == tenant, Job.revision == revision,
            Job.state.in_(("pending", "running")),
        ).values(state="cancelled", revision=Job.revision + 1,
                 lease_token=None, lease_until=0))
        row = await db.scalar(select(Job).where(Job.id == job_id, Job.tenant == tenant)
                              .execution_options(populate_existing=True))
        if row is None:
            raise HTTPException(404, "job not found")
        if changed.rowcount != 1:
            raise HTTPException(409, "state or revision conflict")
        await record_event(db, row)
        return job_data(row)
