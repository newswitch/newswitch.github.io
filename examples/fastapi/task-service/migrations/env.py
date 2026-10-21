import asyncio
from alembic import context
from task_service.config import Settings
from task_service.database import opened_database
from task_service.models import Base


def migrate(connection):
    context.configure(connection=connection, target_metadata=Base.metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run():
    async with opened_database(Settings().database_url) as database:
        async with database.engine.connect() as connection:
            await connection.run_sync(migrate)


if context.is_offline_mode():
    raise RuntimeError("Use an explicit isolated database for these lab migrations")
else:
    asyncio.run(run())
