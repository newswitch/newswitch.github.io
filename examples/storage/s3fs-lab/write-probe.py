"""Write one unique test object through an explicitly writable s3fs mount.

This is an opt-in remote mutation, not part of repository verification.
An independent API read is still required to validate the result.
"""

import argparse
import json
import os
from pathlib import Path
import uuid


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("mount", type=Path)
    parser.add_argument("--confirm-test-bucket", action="store_true", required=True)
    args = parser.parse_args()
    if not args.mount.is_mount():
        parser.error("mount must be an actual mountpoint")
    relative = Path("learning") / "s3fs-write" / f"{uuid.uuid4().hex}.txt"
    target = args.mount / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = b"s3fs-write-check\n"
    with target.open("wb") as handle:
        handle.write(payload)
        handle.flush()
        os.fsync(handle.fileno())
    print(json.dumps({"key": relative.as_posix(), "bytes": len(payload),
                      "local_calls": "write, flush, fsync and close returned"}))


if __name__ == "__main__":
    main()
