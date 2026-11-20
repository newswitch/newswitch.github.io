#!/bin/sh
set -eu
# No secret value is passed as a command argument or printed.
test -s /run/secrets/root_user
test -s /run/secrets/root_password
export MINIO_ROOT_USER="$(cat /run/secrets/root_user)"
export MINIO_ROOT_PASSWORD="$(cat /run/secrets/root_password)"
exec setpriv --reuid=10001 --regid=10001 --clear-groups /usr/local/bin/minio "$@"
