from datetime import UTC, datetime, timedelta, timezone
from time import monotonic

def main():
    moment = datetime(2026, 10, 20, 0, 0, tzinfo=UTC)
    east_eight = timezone(timedelta(hours=8))
    local = moment.astimezone(east_eight)
    print(moment.isoformat())
    print(local.isoformat())
    print(moment == local)
    deadline = monotonic() + 3.0
    remaining = deadline - monotonic()
    print(0 < remaining <= 3.0)

if __name__ == "__main__":
    main()
