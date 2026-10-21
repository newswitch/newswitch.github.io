import argparse
import asyncio
import json
import signal

from .auth import issue_local
from .config import Settings
from .database import opened_database
from .models import Base
from .worker import Worker


async def operate(args, settings):
    async with opened_database(settings.database_url) as database:
        if args.command == "init-sqlite":
            if not settings.database_url.startswith("sqlite+aiosqlite://"):
                raise ValueError("init-sqlite only supports an isolated SQLite lab")
            async with database.engine.begin() as connection:
                await connection.run_sync(Base.metadata.create_all)
            print("schema ready")
        else:
            worker = Worker(database, lease_seconds=settings.lease_seconds,
                            max_attempts=settings.max_attempts)
            if args.once:
                print(json.dumps({"completed": await worker.run_once()}))
            else:
                stopped = asyncio.Event()
                loop = asyncio.get_running_loop()
                registered = []
                for sig in (signal.SIGTERM, signal.SIGINT):
                    try:
                        loop.add_signal_handler(sig, stopped.set)
                        registered.append(sig)
                    except NotImplementedError:
                        pass  # Windows console interruption is handled by asyncio.run.
                try:
                    while not stopped.is_set():
                        try:
                            worked = await worker.run_once()
                        except Exception as error:
                            print(json.dumps({"worker_error": type(error).__name__}))
                            worked = False
                        if not worked:
                            try:
                                await asyncio.wait_for(stopped.wait(), timeout=1)
                            except TimeoutError:
                                pass
                finally:
                    for sig in registered:
                        loop.remove_signal_handler(sig)


def main():
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("init-sqlite")
    token = commands.add_parser("token")
    token.add_argument("--tenant", default="lab")
    worker = commands.add_parser("worker")
    worker.add_argument("--once", action="store_true")
    args = parser.parse_args()
    settings = Settings()
    if args.command == "token":
        print(issue_local(settings.jwt_secret.get_secret_value(), args.tenant))
    else:
        try:
            asyncio.run(operate(args, settings))
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
