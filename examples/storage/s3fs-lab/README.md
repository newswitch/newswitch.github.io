# s3fs-fuse 1.97 laboratory examples

These are deployment templates, not a production CSI driver or an executable integration test. They have not been mounted against an object store by the repository checks.

The local `.gitattributes` preserves LF line endings for Linux source and deployment files, including checkouts with `core.autocrlf=true` on Windows.

- `s3fs-readonly.service`: Linux foreground mount supervised by systemd. Requires the source build at `/opt/s3fs/1.97/bin/s3fs`, a prepared `s3reader` account, local directories and a mode-0600 credential file owned by that account. Replace the bucket, endpoint and region.
- `Dockerfile`: builds tag `v1.97` with FUSE 3 and OpenSSL. Ubuntu packages are resolved when building, not locked by an APT snapshot. Record the printed upstream commit and image digest; use approved base-image digests and package snapshots for a reproducible release. Build for the worker architecture.
- `run-readonly.sh`: starts only its own read-only s3fs child, checks mount establishment, waits for the child and handles termination. It does not launch a business application. Cache and temporary files stay outside the mountpoint. Credentials are never printed.
- `pod-readonly.yaml`: **privileged laboratory Pod**, for an explicitly approved isolated namespace and node only. Baseline/Restricted admission should reject it. It is not a model-serving Pod security recommendation. The only hostPath is `/dev/fuse`; there is no mount propagation or shared host mount directory.

Before using the Pod, prepare all of the following:

1. An approved namespace `storage-lab` and Linux node with `/dev/fuse` and the operator-approved label `storage.example.com/fuse-lab=true`.
2. An owned test bucket with `health/ready.txt`; use a read-only identity. The simple passwd file supports an access-key/secret pair. Session credentials need their supported token and renewal path, not a token appended to this file.
3. A trusted HTTPS endpoint reachable from that Pod, correct region and path-style support. Add an internal CA through the system trust store if necessary; do not disable verification.
4. A `s3fs-credentials` Secret created outside Git from a protected local file named as the `passwd` key. No credentials are committed here.
5. The image built and pushed to an approved registry, replacing the example image in the YAML. Pin the resulting digest for an actual release.

The 4-GiB cache is for small-file demonstrations, not a capacity recommendation for model weights. `emptyDir.sizeLimit` and ephemeral-storage limits do not create a separate guaranteed filesystem quota for s3fs. Probes may hit caches and are not independent tests of backend freshness. A remote outage is not a reason to restart every Pod.

Use a platform-reviewed CSI driver, application SDK or download-and-verify path for production as appropriate. Do not expand application privileges or mount propagation merely to make this laboratory template pass admission.
