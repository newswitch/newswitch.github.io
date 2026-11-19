#!/usr/bin/env bash
set -Eeuo pipefail

: "${S3_BUCKET:?set S3_BUCKET}"
: "${S3_ENDPOINT:?set S3_ENDPOINT}"
: "${S3_REGION:?set S3_REGION}"
S3FS_CRED_FILE="${S3FS_CRED_FILE:-/run/s3-credentials/passwd}"
FUSE_PID=''

cleanup() {
  trap - EXIT TERM INT
  set +e
  if [[ -n "$FUSE_PID" ]] && mountpoint -q /mnt/s3; then
    timeout 10 fusermount3 -u /mnt/s3
  fi
  if [[ -n "$FUSE_PID" ]] && kill -0 "$FUSE_PID" 2>/dev/null; then
    kill -TERM "$FUSE_PID" 2>/dev/null
    for _ in {1..5}; do
      kill -0 "$FUSE_PID" 2>/dev/null || break
      sleep 1
    done
    kill -KILL "$FUSE_PID" 2>/dev/null || true
  fi
  [[ -z "$FUSE_PID" ]] || wait "$FUSE_PID" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

[[ -r "$S3FS_CRED_FILE" ]] || { echo 'credential file is not readable' >&2; exit 1; }
mountpoint -q /mnt/s3 && { echo 'mountpoint is already occupied' >&2; exit 1; }
mkdir -p /var/cache/s3fs/data /var/cache/s3fs/tmp
s3fs --version
s3fs "$S3_BUCKET" /mnt/s3 -f \
  -o ro -o "passwd_file=$S3FS_CRED_FILE" \
  -o "url=$S3_ENDPOINT" -o "endpoint=$S3_REGION" \
  -o use_path_request_style -o sigv4 \
  -o complement_stat -o default_permissions -o umask=027 \
  -o use_cache=/var/cache/s3fs/data -o tmpdir=/var/cache/s3fs/tmp \
  -o stat_cache_expire=30 -o disable_negative_cache \
  -o ensure_diskfree=1024 -o max_thread_count=4 \
  -o connect_timeout=10 -o readwrite_timeout=20 -o retries=2 &
FUSE_PID=$!

for _ in {1..60}; do
  if ! kill -0 "$FUSE_PID" 2>/dev/null; then
    echo 's3fs exited before mount became ready' >&2
    exit 1
  fi
  mountpoint -q /mnt/s3 && break
  sleep 1
done
mountpoint -q /mnt/s3 || { echo 'mount did not become ready within 60 seconds' >&2; exit 1; }

if wait "$FUSE_PID"; then
  echo 's3fs exited unexpectedly' >&2
  exit 1
else
  exit "$?"
fi
