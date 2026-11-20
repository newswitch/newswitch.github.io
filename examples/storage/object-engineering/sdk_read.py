"""Opt-in single-object read. Imports Boto3 only in the command-line entry point."""
from contextlib import closing
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile


def download_checked(client, bucket, key, target, expected_size, expected_sha256, version_id=None):
    if not bucket or not key:
        raise ValueError("Bucket and Key are required")
    if type(expected_size) is not int or expected_size < 0:
        raise ValueError("Expected size must be a nonnegative integer")
    if not isinstance(expected_sha256, str) or not re.fullmatch(r"[0-9a-fA-F]{64}", expected_sha256):
        raise ValueError("Expected SHA-256 must contain 64 hexadecimal characters")
    destination = Path(target)
    if destination.exists():
        raise FileExistsError(destination)
    request = {"Bucket": bucket, "Key": key}
    if version_id is not None:
        request["VersionId"] = version_id
    fd, temporary = tempfile.mkstemp(prefix="object-read-", suffix=".part", dir=destination.parent)
    try:
        with os.fdopen(fd, "wb") as output:
            response = client.get_object(**request)
            with closing(response["Body"]) as body:
                if response.get("ContentLength") != expected_size:
                    raise ValueError("Response length differs from trusted manifest")
                if version_id is not None and response.get("VersionId") != version_id:
                    raise ValueError("Response version differs from requested version")
                digest = hashlib.sha256()
                received = 0
                for chunk in body.iter_chunks(chunk_size=64 * 1024):
                    if not chunk:
                        continue
                    received += len(chunk)
                    if received > expected_size:
                        raise ValueError("Body exceeds trusted length")
                    output.write(chunk)
                    digest.update(chunk)
                if received != expected_size:
                    raise EOFError("Body ended before trusted length")
                actual = digest.hexdigest()
                if actual != expected_sha256.lower():
                    raise ValueError("Body SHA-256 differs from trusted manifest")
            output.flush()
            os.fsync(output.fileno())
        # Same filesystem, no overwrite. The caller must own/trust this directory.
        os.link(temporary, destination)
        return {"bytes": received, "sha256": actual, "version_id": response.get("VersionId")}
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("bucket")
    parser.add_argument("key")
    parser.add_argument("target")
    parser.add_argument("--bytes", type=int, required=True, dest="expected_size")
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--version-id")
    args = parser.parse_args()
    import boto3
    from botocore.config import Config
    client = boto3.Session().client(
        "s3", endpoint_url=os.environ.get("S3_ENDPOINT"),
        region_name=os.environ.get("AWS_REGION", "us-west-2"),
        config=Config(connect_timeout=3, read_timeout=15, max_pool_connections=8,
                      retries={"mode": "standard", "total_max_attempts": 4}),
    )
    try:
        result = download_checked(client, args.bucket, args.key, args.target,
                                  args.expected_size, args.sha256, args.version_id)
        print(json.dumps(result, sort_keys=True))
    finally:
        client.close()


if __name__ == "__main__":
    main()
