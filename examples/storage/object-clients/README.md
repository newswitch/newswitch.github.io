# Object client examples

- `read_window.py` provides a bounded read-only function and an opt-in S3 CLI. Real use requires the pinned dependencies, prepared credentials and a compatible endpoint. The CLI does not print data or credentials. This is a one-shot process; services need their own SDK/session lifecycle design.
- `test_read_window.py` runs 12 standard-library tests with a BytesIO-backed fake. It does not import s3fs, verify its caching implementation or send Range requests. Run `python -m unittest discover -s examples/storage/object-clients -p test_read_window.py` from the repository root.
- `requirements.txt` pins the two direct Python dependencies only, not a complete transitive lock.
- `multipart_fixture.mjs` prepares a 6-MiB first part and a 4-byte last part in an existing private directory, builds the completion JSON from actual UploadPart replies, and verifies a downloaded file. It never uploads, deletes or aborts anything. New fixture/output files use exclusive creation so an existing file is not overwritten.

Fixture preparation writes local files. The commands in the MinIO article separately perform opt-in remote writes to an owned test bucket; they are never executed by the documentation checker. A failed upload can leave incomplete multipart data and requires scoped inspection. No credential files belong in this directory.
