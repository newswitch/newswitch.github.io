"""Single-process JSON task tool. The store is explicitly chosen by the caller."""
import argparse
import json
import os
from pathlib import Path
import tempfile


def load(path):
    if not path.exists():
        return []
    if path.stat().st_size > 2 * 1024 * 1024:
        raise ValueError("store too large")
    rows = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(rows, list) or len(rows) > 10000:
        raise ValueError("invalid store")
    seen = set()
    for row in rows:
        if (not isinstance(row, dict) or set(row) != {"id", "name", "state"}
                or type(row["id"]) is not int or row["id"] <= 0
                or row["id"] in seen or not isinstance(row["name"], str)
                or not 1 <= len(row["name"].strip()) <= 80
                or row["state"] not in ("ready", "done")):
            raise ValueError("invalid row")
        seen.add(row["id"])
    return rows


def save(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=path.parent, delete=False,
        ) as stream:
            temporary = Path(stream.name)
            json.dump(rows, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def add(rows, name):
    name = name.strip()
    if not 1 <= len(name) <= 80 or len(rows) >= 10000:
        raise ValueError("invalid name or store full")
    row = {"id": max((row["id"] for row in rows), default=0) + 1,
           "name": name, "state": "ready"}
    return [*rows, row], row


def complete(rows, job_id):
    found = next((row for row in rows if row["id"] == job_id), None)
    if found is None:
        raise ValueError("job not found")
    updated = {**found, "state": "done"}
    return [updated if row["id"] == job_id else row for row in rows], updated


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--store", type=Path, required=True)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("list")
    create = commands.add_parser("add")
    create.add_argument("name")
    finish = commands.add_parser("complete")
    finish.add_argument("id", type=int)
    args = parser.parse_args(argv)
    try:
        rows = load(args.store)
        if args.command == "list":
            result = rows
        elif args.command == "add":
            rows, result = add(rows, args.name)
            save(args.store, rows)
        else:
            rows, result = complete(rows, args.id)
            save(args.store, rows)
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    except (ValueError, OSError) as error:
        parser.exit(2, f"error: {error}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
