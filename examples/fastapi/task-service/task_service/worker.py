import asyncio
from dataclasses import dataclass
import time
from uuid import uuid4

from sqlalchemy import and_, or_, select, update

from .models import Job, Result, record_event


@dataclass(frozen=True)
class Lease:
    job_id: int
    name: str
    token: str
    attempt: int


class LostLease(RuntimeError):
    pass


class Worker:
    def __init__(self, database, *, lease_seconds=15, max_attempts=3, clock=time.time):
        self.database = database
        self.lease_seconds = lease_seconds
        self.max_attempts = max_attempts
        self.clock = clock

    async def claim(self):
        now = self.clock()
        eligible = or_(and_(Job.state == "pending", Job.available_at <= now),
                       and_(Job.state == "running", Job.lease_until <= now))
        async with self.database.sessions.begin() as db:
            query = select(Job).where(eligible).order_by(Job.id).limit(1)
            if self.database.engine.dialect.name == "postgresql":
                query = query.with_for_update(skip_locked=True)
            row = await db.scalar(query)
            if row is None:
                return None
            if row.attempts >= self.max_attempts:
                row.state, row.lease_token, row.lease_until = "failed", None, 0
                row.revision += 1
                await record_event(db, row)
                return None
            token = uuid4().hex
            changed = await db.execute(update(Job).where(
                Job.id == row.id, eligible, Job.revision == row.revision,
            ).values(state="running", lease_token=token,
                     lease_until=now + self.lease_seconds,
                     attempts=Job.attempts + 1, revision=Job.revision + 1)
                .execution_options(synchronize_session=False))
            if changed.rowcount != 1:
                return None
            await db.refresh(row)
            await record_event(db, row)
            return Lease(row.id, row.name, token, row.attempts)

    def owned(self, lease):
        return (Job.id == lease.job_id, Job.state == "running",
                Job.lease_token == lease.token, Job.lease_until > self.clock())

    async def heartbeat(self, lease):
        async with self.database.sessions.begin() as db:
            changed = await db.execute(update(Job).where(*self.owned(lease)).values(
                lease_until=self.clock() + self.lease_seconds))
            return changed.rowcount == 1

    async def finish(self, lease, value):
        if not isinstance(value, str) or len(value) > 320:
            raise ValueError("invalid result")
        async with self.database.sessions.begin() as db:
            changed = await db.execute(update(Job).where(*self.owned(lease)).values(
                state="done", revision=Job.revision + 1, lease_token=None, lease_until=0))
            if changed.rowcount != 1:
                return False
            db.add(Result(job_id=lease.job_id, value=value))
            row = await db.get(Job, lease.job_id)
            await record_event(db, row)
            return True

    async def fail(self, lease):
        async with self.database.sessions.begin() as db:
            changed = await db.execute(update(Job).where(*self.owned(lease)).values(
                state="failed" if lease.attempt >= self.max_attempts else "pending",
                revision=Job.revision + 1, lease_token=None, lease_until=0,
                available_at=self.clock() + min(2 ** lease.attempt, 30)))
            if changed.rowcount != 1:
                return False
            row = await db.get(Job, lease.job_id)
            await record_event(db, row)
            return True

    async def run_once(self, execute=None):
        lease = await self.claim()
        if lease is None:
            return False
        stopped = asyncio.Event()

        async def renew():
            while True:
                try:
                    await asyncio.wait_for(stopped.wait(), self.lease_seconds / 3)
                    return
                except TimeoutError:
                    if not await self.heartbeat(lease):
                        raise LostLease("ownership changed")

        async def perform():
            try:
                async with asyncio.timeout(30):
                    if execute is None:
                        return lease.name.upper()
                    return await execute(lease.name)
            finally:
                stopped.set()

        try:
            async with asyncio.TaskGroup() as group:
                group.create_task(renew())
                result = group.create_task(perform())
            return await self.finish(lease, result.result())
        except Exception:
            await self.fail(lease)
            raise
