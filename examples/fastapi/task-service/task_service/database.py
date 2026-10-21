from contextlib import asynccontextmanager

from sqlalchemy import event
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


class Database:
    def __init__(self, url):
        options = {"pool_pre_ping": True}
        if url.startswith("sqlite"):
            options["connect_args"] = {"timeout": 10}
        else:
            options.update(pool_size=5, max_overflow=0, pool_timeout=2,
                           connect_args={"command_timeout": 5})
        self.engine = create_async_engine(url, **options)
        if url.startswith("sqlite"):
            @event.listens_for(self.engine.sync_engine, "connect")
            def foreign_keys(connection, _):
                cursor = connection.cursor()
                cursor.execute("PRAGMA foreign_keys=ON")
                cursor.close()
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)

    async def close(self):
        await self.engine.dispose()


@asynccontextmanager
async def opened_database(url):
    database = Database(url)
    try:
        yield database
    finally:
        await database.close()
