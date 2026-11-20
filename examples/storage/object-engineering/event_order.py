"""Pure parser for raw AWS S3 create/remove events; no queue or durable inbox."""
from dataclasses import dataclass
import hashlib
import json
import re
from urllib.parse import unquote_plus


@dataclass(frozen=True)
class ObjectEvent:
    bucket: str
    key: str
    version_id: str
    name: str
    sequencer: int
    source: str = "aws:s3"

    @property
    def event_id(self):
        identity = [self.source, self.bucket, self.key, self.version_id, self.name, self.sequencer]
        encoded = json.dumps(identity, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()


def parse_events(payload):
    records = payload.get("Records")
    if not isinstance(records, list) or len(records) > 1000:
        raise ValueError("Expected a bounded raw S3 Records list")
    result = []
    for record in records:
        if not re.fullmatch(r"2\.\d+", record.get("eventVersion", "")):
            raise ValueError("Unsupported event schema")
        if record.get("eventSource") != "aws:s3":
            raise ValueError("This adapter only handles raw AWS S3 events")
        name = record.get("eventName", "")
        if not name.startswith(("ObjectCreated:", "ObjectRemoved:")):
            raise ValueError("Only sequenced create/remove events are supported")
        obj = record["s3"]["object"]
        encoded_key = obj["key"]
        if not encoded_key or re.search(r"%(?![0-9A-Fa-f]{2})", encoded_key):
            raise ValueError("Invalid encoded key")
        key = unquote_plus(encoded_key, encoding="utf-8", errors="strict")
        sequence = obj.get("sequencer", "")
        if not re.fullmatch(r"[0-9A-Fa-f]{1,128}", sequence):
            raise ValueError("Missing or invalid sequencer")
        bucket = record["s3"]["bucket"]["name"]
        if not isinstance(bucket, str) or not bucket:
            raise ValueError("Missing bucket")
        version = obj.get("versionId")
        if version is not None and not isinstance(version, str):
            raise ValueError("Invalid version")
        result.append(ObjectEvent(bucket, key, version or "", name, int(sequence, 16)))
    return result


def is_newer(event, previous):
    if (event.source, event.bucket, event.key) != (previous.source, previous.bucket, previous.key):
        raise ValueError("Sequencers cannot order different objects")
    return event.sequencer > previous.sequencer
