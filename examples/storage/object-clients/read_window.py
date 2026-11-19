"""Bounded, read-only S3 window access. Importing this module does no network I/O."""

import argparse
import hashlib
import json
import os

MAX_WINDOW = 16 * 1024 * 1024
MAX_BLOCK = 64 * 1024 * 1024


def read_window(fs, key, offset, length, *, block_size=8 * 1024 * 1024, version_id=None):
    if not isinstance(key, str) or "/" not in key or not all(key.split("/", 1)):
        raise ValueError("use a bucket/key identifier")
    if type(offset) is not int or offset < 0:
        raise ValueError("offset must be a non-negative integer")
    if type(length) is not int or not 1 <= length <= MAX_WINDOW:
        raise ValueError("length is outside the demonstration window limit")
    if type(block_size) is not int or not 1 <= block_size <= MAX_BLOCK:
        raise ValueError("block_size is outside the demonstration limit")
    options = {"block_size": block_size, "cache_type": "readahead"}
    if version_id is not None:
        if not isinstance(version_id, str) or not version_id:
            raise ValueError("version_id must be a non-empty string")
        options["version_id"] = version_id
    with fs.open(key, "rb", **options) as handle:
        handle.seek(offset)
        result = handle.read(length)
    if len(result) != length:
        raise EOFError("short read; check object identity, size and requested window")
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("key", help="bucket/key, optionally beginning with s3://")
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--length", type=int, default=1024)
    parser.add_argument("--version-id")
    args = parser.parse_args()
    import s3fs

    client = {}
    config = {}
    if os.environ.get("OBJECT_ENDPOINT"):
        client["endpoint_url"] = os.environ["OBJECT_ENDPOINT"]
        config["s3"] = {"addressing_style": "path"}
    if os.environ.get("OBJECT_REGION"):
        client["region_name"] = os.environ["OBJECT_REGION"]
    fs = s3fs.S3FileSystem(anon=False, client_kwargs=client, config_kwargs=config,
                         version_aware=args.version_id is not None)
    result = read_window(fs, args.key.removeprefix("s3://"), args.offset,
                         args.length, version_id=args.version_id)
    print(json.dumps({"bytes": len(result), "sha256": hashlib.sha256(result).hexdigest()}))


if __name__ == "__main__":
    main()
